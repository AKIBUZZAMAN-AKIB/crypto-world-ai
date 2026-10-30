// Real Monaco interactions on the existing offline workspace, with its actual Pine
// engine explicitly enabled by the editor preview. No screenshots or mock HTML pages.
import { chromium } from 'playwright';
import { OFFLINE, assert, report } from './helpers.mjs';

const url = new URL(OFFLINE);
url.searchParams.set('preview', 'editor');
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await desktop.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin });
const page = await desktop.newPage();
const errors = [];
const workers = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('worker', (worker) => workers.push(worker.url()));
const editor = '.vela-pe .monaco-editor';
const lines = '.vela-pe .view-lines';
const input = '.vela-pe textarea.inputarea';
const library = () => page.evaluate(() => JSON.parse(localStorage.getItem('vela-pine-library')));
const activeCode = async () => {
    const stored = await library();
    return stored.scripts.find((script) => script.id === stored.activeId)?.code;
};
const focusEditor = async () => {
    await page.locator(lines).click({ position: { x: 120, y: 25 } });
    await page.locator(input).waitFor();
};
const replaceCode = async (code) => {
    await focusEditor();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(code);
    await page.waitForTimeout(150);
};
const invokeMore = async (label) => {
    await page.locator('.vela-pe [aria-label="More actions"]').click();
    await page.locator('.vela-pe-row', { hasText: label }).click();
};
const invokeAction = async (label) => {
    await page.locator('.vela-pe-status-action').click();
    await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click();
};

try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.locator(editor).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const initial = await page.evaluate(() => {
        const pane = document.querySelector('.vela-pe');
        const style = getComputedStyle(pane);
        const rect = pane.getBoundingClientRect();
        return { standard: pane.dataset.standardPane, radius: style.borderRadius, shadow: style.boxShadow,
            width: rect.width, height: rect.height, heading: pane.querySelector('.vela-pe-name')?.textContent,
            maximize: getComputedStyle(pane.querySelector('.vela-panel-max')).display !== 'none' };
    });
    assert(initial.standard === '1' && initial.radius === '0px' && initial.shadow === 'none' && !initial.maximize,
        'desktop editor uses the square standard dock and no maximize control', initial);
    assert(/My script/.test(initial.heading ?? ''), 'the original script selector remains in the heading', initial.heading);
    assert(await page.locator('.vela-pe .view-line').count() > 0, 'Monaco actually renders code');
    assert(await page.locator('.vela-pe-input').count() === 0, 'the old textarea overlay is not the editing surface');

    await replaceCode('//@version=6\nindicator("Hints")\nx = ta.sm');
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    const completion = await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts();
    assert(completion.some((row) => /sma/.test(row)), 'technical-analysis completion offers the requested function', completion);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert((await activeCode()).includes('ta.sma()'), 'accepting a completion edits the actual model', await activeCode());
    await page.keyboard.type('close, ', { delay: 30 });
    await page.locator('.parameter-hints-widget.visible').waitFor({ timeout: 10_000 });
    const hint = await page.locator('.parameter-hints-widget.visible').innerText();
    assert(hint.includes('ta.sma(source, length)') && /int/.test(hint), 'parameter help shows the current argument and its type', hint);

    await replaceCode('//@version=6\nindicator("Hints")\nmyLength = 14\nx = myL');
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    const local = await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts();
    assert(local.some((row) => row.includes('myLength')), 'a user-defined symbol is suggested', local);
    await page.keyboard.press('Escape');
    await replaceCode('//@version=6\nindicator("Hints")\nx = input.int(20, mi');
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    const named = await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts();
    assert(named.some((row) => row.includes('minval')), 'a named overload parameter is suggested', named);
    await page.keyboard.press('Escape');
    await replaceCode('//@version=6\nindicator("Hints")\nvar array<float> prices = array.new<float>()\nprices.pu');
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    const method = await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts();
    assert(method.some((row) => row.includes('push') && row.includes('prices.push(value)')), 'a typed array method omits its receiver from the signature', method);
    await page.keyboard.press('Escape');
    const userTypeCode = '//@version=6\ntype Pivot\n    float price\nmethod move(Pivot self, float amount) =>\n    self.price += amount\nPivot p = Pivot.new()\np.pr';
    await replaceCode(userTypeCode);
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    assert((await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts()).some((row) => row.includes('price')),
        'a declared user-type field is suggested for its recognized receiver');
    await page.keyboard.press('Enter');
    assert((await activeCode()).includes('p.price') && !(await activeCode()).includes('p.price()'),
        'accepting a field inserts a property, not a function call', await activeCode());
    await replaceCode(userTypeCode.replace('p.pr', 'p.mo'));
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    assert((await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts()).some((row) => row.includes('move')),
        'a user-declared method is suggested for a matching type');
    await page.keyboard.press('Enter');
    assert((await activeCode()).includes('p.move()'), 'accepting a user method inserts a callable form', await activeCode());
    await page.keyboard.press('Escape');

    await page.locator(lines).click({ button: 'right', position: { x: 130, y: 25 } });
    await page.locator('.context-view.monaco-menu-container').waitFor({ state: 'visible', timeout: 10_000 });
    const nativeMenu = await page.locator('.context-view.monaco-menu-container .action-label').allInnerTexts();
    assert(nativeMenu.some((label) => /Copy/.test(label)), 'desktop right-click opens Monaco’s native context menu', nativeMenu);
    await page.keyboard.press('Escape');
    await page.locator('.vela-pe-status-action').click();
    await page.getByRole('menuitem', { name: 'Command palette' }).click();
    await page.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
    assert((await page.locator('.quick-input-widget').innerText()).includes('Command Palette'), 'the editor command palette is real and usable');
    await page.keyboard.press('Escape');

    const actionCode = '//@version=6\nindicator("Actions")\nplot(close)\n';
    await replaceCode(actionCode);
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('// undo marker');
    await invokeAction('Undo');
    await page.waitForTimeout(120);
    assert(!(await activeCode()).includes('undo marker'), 'Undo in the actions menu edits the model');
    await invokeAction('Redo');
    await page.waitForTimeout(120);
    assert((await activeCode()).includes('undo marker'), 'Redo in the actions menu restores the edit');
    await invokeAction('Select all');
    await invokeAction('Cut');
    await page.waitForFunction(() => {
        const stored = JSON.parse(localStorage.getItem('vela-pine-library'));
        return stored.scripts.find((script) => script.id === stored.activeId)?.code === '';
    });
    await invokeAction('Paste');
    await page.waitForFunction(() => {
        const stored = JSON.parse(localStorage.getItem('vela-pine-library'));
        return stored.scripts.find((script) => script.id === stored.activeId)?.code.includes('undo marker');
    });
    assert((await activeCode()).includes('plot(close)'), 'Cut and Paste use the real clipboard and preserve the source');
    await invokeAction('Find');
    assert(await page.locator('.find-widget').isVisible(), 'Find opens the real editor find widget');
    await page.keyboard.press('Escape');
    await invokeAction('Replace');
    assert((await page.locator('.find-widget').getAttribute('class')).includes('replaceToggled'), 'Replace opens the real editor replacement widget');
    await page.keyboard.press('Escape');
    const beforeComment = await activeCode();
    await invokeAction('Toggle line comment');
    assert(await activeCode() !== beforeComment, 'Toggle line comment changes the actual model');
    await replaceCode('ta.sm');
    await invokeAction('Suggest');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    assert((await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts()).some((row) => row.includes('sma')),
        'Suggest from the actions menu opens real Pine completions');
    await page.keyboard.press('Escape');
    await invokeMore('Editor settings');
    await page.locator('.vela-pe-set', { hasText: 'Suggestions as you type' }).locator('input').uncheck();
    await replaceCode('ta.sm');
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    assert((await page.locator('.suggest-widget.visible .monaco-list-row').allInnerTexts()).some((row) => row.includes('sma')),
        'manual suggestions still work when automatic suggestions are disabled');
    await page.keyboard.press('Escape');
    await invokeMore('Editor settings');
    await page.locator('.vela-pe-set', { hasText: 'Suggestions as you type' }).locator('input').check();

    // An injected engine failure exercises the real console, marker and navigation path;
    // the successful real-engine add/update below is tested separately.
    await replaceCode('//@version=6\nindicator("Error location")\nplot(close)');
    await page.evaluate(() => {
        const chart = window.__ws.active.chart;
        window.__testRunIndicator = chart.runIndicator;
        chart.runIndicator = async () => ({ ok: false, error: Object.assign(new Error('Engine failure at line 3'), { line: 3 }) });
    });
    await page.keyboard.press('Control+Enter');
    await page.locator('.vela-pe-msg-line', { hasText: 'line 3' }).waitFor();
    await page.locator('.vela-pe .squiggly-error').first().waitFor();
    await page.locator('.vela-pe-msg-line', { hasText: 'line 3' }).click();
    assert((await page.locator('.vela-pe-status [data-part="caret"]').innerText()).includes('Ln 3'),
        'clicking an engine error navigates to the reported source line');
    await page.keyboard.press('End');
    await page.keyboard.insertText(' // corrected');
    await page.waitForTimeout(200);
    assert(await page.locator('.vela-pe .squiggly-error').count() === 0,
        'editing clears stale engine markers rather than claiming a new compile');
    await page.evaluate(() => {
        window.__ws.active.chart.runIndicator = () => new Promise((resolve) => { window.__finishFailedRun = resolve; });
    });
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => typeof window.__finishFailedRun === 'function');
    await page.keyboard.insertText(' // newer draft');
    await page.evaluate(() => window.__finishFailedRun({ ok: false, error: Object.assign(new Error('Late engine failure at line 3'), { line: 3 }) }));
    await page.waitForTimeout(200);
    assert(await page.locator('.vela-pe .squiggly-error').count() === 0 && !(await page.locator('.vela-pe-console').innerText()).includes('Late engine failure'),
        'an error returned after an edit cannot mark or mislabel the newer draft');
    await page.evaluate(() => { window.__ws.active.chart.runIndicator = window.__testRunIndicator; delete window.__testRunIndicator; delete window.__finishFailedRun; });

    // Each script has its own model and undo stack, even after changing the active tab.
    await page.locator('.vela-pe-name').click();
    await page.getByLabel('Script name').fill('Undo original');
    await page.getByLabel('Script name').press('Enter');
    await replaceCode('//@version=6\nindicator("Undo base")\nplot(close)');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// original edit');
    await page.waitForTimeout(300);
    await invokeMore('New indicator');
    await page.waitForTimeout(250);
    await replaceCode('//@version=6\nindicator("Other script")\nplot(open)');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// other edit');
    await page.locator('.vela-pe-name').click();
    await page.locator('.vela-pe-row', { hasText: 'Undo original' }).click();
    assert((await activeCode()).includes('// original edit'), 'switching back restores the original model');
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(150);
    assert(!(await activeCode()).includes('// original edit') && (await activeCode()).includes('Undo base'),
        'undo after a script switch uses that script’s own edit history', await activeCode());
    await page.keyboard.press('Control+Shift+Z');
    await page.waitForTimeout(150);
    assert((await activeCode()).includes('// original edit'), 'redo restores the same script’s edit');

    const code = '//@version=6\nindicator("Editor smoke", overlay=true)\nvalue = ta.sma(close, 14)\nplot(value)\n';
    await replaceCode(code);
    await page.keyboard.press('Control+S');
    await page.waitForFunction(() => document.querySelector('.vela-pe-ver')?.textContent === '2.0');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('.vela-pe-console')?.textContent?.includes('added to chart'), null, { timeout: 30_000 });
    const added = await page.evaluate(() => window.__ws.active.chart.indicators().some((entry) => entry.source?.includes('Editor smoke')));
    assert(added, 'the configured Pine engine really adds the edited script to the chart');
    await focusEditor();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// updated from editor');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('.vela-pe-console')?.textContent?.includes('updated on chart'), null, { timeout: 30_000 });
    assert(await page.locator('.vela-pe-ver').innerText() === '2.1', 'an actual update creates the next minor version', await page.locator('.vela-pe-ver').innerText());
    const updated = await activeCode();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(editor).waitFor({ timeout: 60_000 });
    assert(await activeCode() === updated, 'draft and version persist across reload');

    await invokeMore('Version history');
    await page.locator('.vela-pe-pop .vela-pe-row', { hasText: '1.0' }).first().click();
    assert((await activeCode()).includes('My indicator'), 'version history restores the initial draft', await activeCode());

    const beforeBuiltin = await activeCode();
    const builtin = '//@version=6\nindicator("Built in")\nplot(close)';
    await page.evaluate((source) => window.__ws.openEditor(source, 'Built in', { readOnly: true }), builtin);
    await page.waitForFunction(() => document.querySelector('.vela-pe-monaco')?.dataset.readonly === 'true');
    await focusEditor();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('should-not-appear');
    assert(!(await page.locator(lines).innerText()).includes('should-not-appear') && await activeCode() === beforeBuiltin,
        'built-in source is read-only and never edits the active draft');
    await page.locator('.vela-pe-builtin button').click();
    await page.waitForFunction(() => document.querySelector('.vela-pe-monaco')?.dataset.readonly === 'false');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// working copy');
    assert((await activeCode()).includes('// working copy'), 'make a copy creates an editable independent script');

    await focusEditor();
    await page.keyboard.press('Control+A');
    const copiedCode = await activeCode();
    await page.locator('.vela-pe-status-action').click();
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    assert(await page.evaluate(() => navigator.clipboard.readText()) === copiedCode, 'Copy writes the real selected source to the clipboard');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => { throw new Error('denied'); } } }));
    await page.locator('.vela-pe-status-action').click();
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
    await page.locator('.vela-pe-editor-feedback:visible').waitFor();
    assert((await page.locator('.vela-pe-editor-feedback').innerText()).includes('blocked by this browser') && await activeCode() === copiedCode,
        'a denied clipboard read gives a truthful fallback without altering code');
    await page.evaluate(() => delete navigator.clipboard);

    // A genuine engine run is delayed at its return boundary while the user edits and
    // switches scripts. The chart version must record what actually ran, not the new draft.
    await invokeMore('New indicator');
    await page.locator('.vela-pe-name').click();
    await page.getByLabel('Script name').fill('Race script');
    await page.getByLabel('Script name').press('Enter');
    const raceSource = '//@version=6\nindicator("Run snapshot")\nplot(close)';
    await replaceCode(raceSource);
    const raceId = (await library()).activeId;
    await page.evaluate(() => {
        const chart = window.__ws.active.chart;
        window.__realRunIndicator = chart.runIndicator;
        chart.runIndicator = async (...args) => {
            const result = await window.__realRunIndicator.apply(chart, args);
            await new Promise((resolve) => { window.__releaseSuccessfulRun = resolve; });
            return result;
        };
    });
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => typeof window.__releaseSuccessfulRun === 'function', null, { timeout: 30_000 });
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// newer draft');
    await page.locator('.vela-pe-name').click();
    await page.locator('.vela-pe-row', { hasText: 'Undo original' }).click();
    const switchedId = (await library()).activeId;
    await page.evaluate(() => window.__releaseSuccessfulRun());
    await page.waitForFunction(({ id, source }) => {
        const stored = JSON.parse(localStorage.getItem('vela-pine-library'));
        return stored.scripts.find((script) => script.id === id)?.versions.some((version) => version.kind === 'update' && version.code === source);
    }, { id: raceId, source: raceSource }, { timeout: 10_000 });
    const afterRace = await library();
    const raced = afterRace.scripts.find((script) => script.id === raceId);
    assert(afterRace.activeId === switchedId && raced.code.includes('// newer draft') && raced.versions.at(-1).code === raceSource,
        'a delayed successful run versions its original source and preserves the newer draft and active script', { switchedId, afterRace, raced });
    assert(await page.evaluate((id) => window.__ws.active.chart.indicators().some((entry) => entry.id === `pe-${id}`), raceId),
        'the delayed snapshot was actually added by the real engine');
    await page.evaluate(() => { window.__ws.active.chart.runIndicator = window.__realRunIndicator; delete window.__realRunIndicator; delete window.__releaseSuccessfulRun; });

    await page.evaluate(() => window.__ws.setTheme('light'));
    await page.waitForTimeout(250);
    const light = await page.locator(editor).evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    await page.evaluate(() => window.__ws.setTheme('dark'));
    await page.waitForTimeout(250);
    const dark = await page.locator(editor).evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    assert(light.bg !== dark.bg && /255, 255, 255/.test(light.bg), 'Monaco follows the workspace light/dark surface', { light, dark });
    assert(workers.some((name) => name.startsWith('blob:')), 'the actual Monaco editor worker is created from an inline blob', workers);
    assert(errors.length === 0, 'no uncaught desktop page errors', errors);

    const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mobile = await phone.newPage();
    const mobileErrors = [];
    mobile.on('pageerror', (error) => mobileErrors.push(String(error)));
    await mobile.goto(url.href, { waitUntil: 'domcontentloaded' });
    await mobile.locator(editor).waitFor({ timeout: 60_000 });
    await mobile.waitForTimeout(400);
    const geometry = await mobile.evaluate(() => {
        const pane = document.querySelector('.vela-pe');
        const parent = pane.parentElement;
        const rect = pane.getBoundingClientRect(), container = parent.getBoundingClientRect();
        const style = getComputedStyle(pane);
        return { mode: document.querySelector('.vela-workspace').dataset.layout, x: rect.x, width: rect.width,
            bottom: rect.bottom, parentBottom: container.bottom, radius: style.borderRadius, shadow: style.boxShadow,
            grip: !!pane.querySelector('.vela-panel-grip'), overflow: document.documentElement.scrollWidth - innerWidth,
            minimap: pane.querySelector('.minimap')?.getBoundingClientRect().width ?? 0 };
    });
    assert(geometry.mode === 'mobile' && geometry.x === 0 && geometry.width === 390 && Math.abs(geometry.bottom - geometry.parentBottom) < 2 &&
        geometry.radius === '0px' && geometry.shadow === 'none' && geometry.grip && geometry.overflow <= 0 && geometry.minimap === 0,
    'phone editor is a full-width square, bottom-attached, height-adjustable pane without a minimap', geometry);
    const mobileLine = await mobile.locator(lines).boundingBox();
    await mobile.touchscreen.tap(mobileLine.x + 100, mobileLine.y + 24);
    await mobile.keyboard.press('Control+End');
    await mobile.keyboard.press('Enter');
    await mobile.keyboard.type('ta.sm', { delay: 35 });
    await mobile.locator('.suggest-widget.visible').waitFor({ timeout: 10_000 });
    const mobileSuggestions = await mobile.locator('.suggest-widget.visible').boundingBox();
    assert(mobileSuggestions.x >= 0 && mobileSuggestions.x + mobileSuggestions.width <= 390, 'phone suggestions remain within the viewport', mobileSuggestions);
    await mobile.locator('.suggest-widget.visible .monaco-list-row', { hasText: 'sma' }).first().tap();
    await mobile.waitForTimeout(250);
    const mobileCode = await mobile.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('vela-pine-library'));
        return stored.scripts.find((script) => script.id === stored.activeId)?.code;
    });
    assert(mobileCode.includes('ta.sma()'), 'a suggestion can be tapped into the phone editor model', mobileCode);
    const touch = await phone.newCDPSession(mobile);
    const area = await mobile.locator('.vela-pe-monaco').boundingBox();
    const x = area.x + 150, y = area.y + 40;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await mobile.waitForTimeout(720);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.locator('.vela-pe-editor-menu').waitFor({ state: 'visible', timeout: 5_000 });
    const touchMenu = await mobile.locator('.vela-pe-editor-menu').boundingBox();
    assert(touchMenu.x >= 0 && touchMenu.x + touchMenu.width <= 390 && touchMenu.y >= area.y && touchMenu.y + touchMenu.height <= area.y + area.height + 1,
        'long-press exposes an in-bounds action menu', touchMenu);
    await mobile.getByRole('menuitem', { name: 'Select all' }).tap();
    const selected = await mobile.locator(input).evaluate((el) => el.selectionEnd > el.selectionStart);
    assert(selected, 'a long-press action executes against the Monaco selection');

    await mobile.keyboard.insertText(Array.from({ length: 100 }, (_, index) => `line${index} = close`).join('\n'));
    await mobile.keyboard.press('Control+Home');
    await mobile.waitForTimeout(250);
    const beforeScroll = (await mobile.locator(lines).innerText()).slice(0, 40);
    const currentArea = await mobile.locator('.vela-pe-monaco').boundingBox();
    const startY = currentArea.y + currentArea.height - 35;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 8; step++) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - step * 17 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForTimeout(500);
    const afterScroll = (await mobile.locator(lines).innerText()).slice(0, 40);
    assert(beforeScroll !== afterScroll && !(await mobile.locator('.vela-pe-editor-menu').isVisible()),
        'touch scrolling still works and movement cancels the long-press', { beforeScroll, afterScroll });
    const grip = await mobile.locator('.vela-pe .vela-panel-grip').boundingBox();
    const oldPane = await mobile.locator('.vela-pe').boundingBox();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + grip.width / 2, y: grip.y + 12 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: grip.x + grip.width / 2, y: grip.y - 100 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForTimeout(300);
    const resized = await mobile.locator('.vela-pe').boundingBox();
    assert(resized.height > oldPane.height + 80 && Math.abs(resized.y + resized.height - oldPane.y - oldPane.height) < 2,
        'dragging the shared grip changes pane height while keeping it attached', { oldPane, resized });
    await mobile.setViewportSize({ width: 780, height: 390 });
    await mobile.waitForTimeout(550);
    assert(await mobile.locator('.vela-workspace').getAttribute('data-layout') === 'desktop', 'landscape phone uses desktop-like chrome');
    assert(mobileErrors.length === 0, 'no uncaught phone-emulation page errors', mobileErrors);
    report('pine-editor', { desktop: initial, completion: completion.slice(0, 3), hint, method: method.slice(0, 2), light, dark,
        phone: geometry, longPress: touchMenu, scrolled: beforeScroll !== afterScroll, resized: resized.height, workers: workers.length, errors, mobileErrors });
    await phone.close();
} finally {
    await desktop.close();
    await browser.close();
}
