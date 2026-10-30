// Desktop panel headers move; phone headers stay still and grips resize without a popup.
// Width resizing, maximize, redocking and compact headers remain available.
import { open, assert, report, OFFLINE, installMovablePanel } from './helpers.mjs';

// ── Desktop: a contributed panel keeps width, maximize and movement ──
const desktop = await open({ base: OFFLINE, viewport: { width: 1280, height: 820 }, settle: 1300 });
const d = desktop.page;
await installMovablePanel(d);
await d.evaluate(() => window.__ws.dock.toggle('resizeProbe', true));
await d.waitForSelector('.vela-panel.vela-panel-resizeProbe', { timeout: 5000 });
const desktopBefore = await d.evaluate(() => {
    const panel = document.querySelector('.vela-panel.vela-panel-resizeProbe');
    return {
        width: panel?.getBoundingClientRect().width ?? 0,
        resizer: !!panel?.querySelector('.vela-panel-resizer'),
        max: !!panel?.querySelector('.vela-panel-max'),
        grip: !!panel?.querySelector('.vela-panel-grip'),
        moves: panel?.querySelectorAll('.vela-panel-move').length ?? 0,
    };
});
assert(desktopBefore.resizer && desktopBefore.max, 'desktop contributed panel has resize and maximize controls', desktopBefore);
assert(desktopBefore.grip && desktopBefore.moves === 0, 'there are no redundant movement buttons in the header', desktopBefore);
const gripBoxDesktop = await d.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-grip').boundingBox();
assert(gripBoxDesktop && gripBoxDesktop.height >= 24, 'desktop also has a usable vertical resize grip', gripBoxDesktop);

// Drag the inner edge: a wider panel, persisted through the dock.
const seam = await d.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-resizer').boundingBox();
assert(!!seam, 'the desktop resize seam has a hit box', seam);
await d.mouse.move(seam.x + seam.width / 2, seam.y + seam.height / 2);
await d.mouse.down();
await d.mouse.move(seam.x + seam.width / 2 - 70, seam.y + seam.height / 2, { steps: 8 });
await d.mouse.up();
await d.waitForTimeout(200);
const desktopAfterWidth = await d.evaluate(() => document.querySelector('.vela-panel.vela-panel-resizeProbe')?.getBoundingClientRect().width ?? 0);
assert(desktopAfterWidth > desktopBefore.width + 40, 'dragging the seam widens the docked panel', { before: desktopBefore.width, after: desktopAfterWidth });
await d.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-max').click();
const maximized = await d.evaluate(() => ({
    flag: document.querySelector('.vela-panel.vela-panel-resizeProbe')?.dataset.maximized ?? null,
    width: document.querySelector('.vela-panel.vela-panel-resizeProbe')?.getBoundingClientRect().width ?? 0,
    host: document.querySelector('.vela-panel.vela-panel-resizeProbe')?.parentElement?.getBoundingClientRect().width ?? 0,
}));
assert(maximized.flag === '1' && maximized.width >= maximized.host - 2, 'maximize covers the dock host', maximized);
await d.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-max').click();
// Drag the docked panel's title to float it; a second drag must preserve its size.
const desktopTitle = d.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-title');
let titleBox = await desktopTitle.boundingBox();
await d.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
await d.mouse.down();
await d.mouse.move(titleBox.x + titleBox.width / 2 - 70, titleBox.y + titleBox.height / 2 + 80, { steps: 8 });
await d.mouse.up();
await d.waitForTimeout(150);
const floated = await d.locator('.vela-panel.vela-panel-resizeProbe').boundingBox();
assert(await d.locator('.vela-panel.vela-panel-resizeProbe').getAttribute('data-free-floating') === '1', 'title drag floats the desktop panel', floated);
titleBox = await desktopTitle.boundingBox();
await d.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
await d.mouse.down();
await d.mouse.move(titleBox.x + titleBox.width / 2 - 30, titleBox.y + titleBox.height / 2 + 35, { steps: 8 });
await d.mouse.up();
await d.waitForTimeout(150);
const floatedAgain = await d.locator('.vela-panel.vela-panel-resizeProbe').boundingBox();
assert(floatedAgain.y > floated.y + 20 && Math.abs(floatedAgain.height - floated.height) < 2 && Math.abs(floatedAgain.width - floated.width) < 2, 'floating panel moves without resizing', { floated, floatedAgain });
await desktopTitle.dblclick();
assert(await d.locator('.vela-panel.vela-panel-resizeProbe').getAttribute('data-free-floating') === null, 'double-click returns the panel to its dock');
assert(desktop.errors.length === 0, 'no desktop page errors', desktop.errors.slice(0, 3));
await desktop.browser.close();

// ── Phone: a contributed bottom pane remains attached and can still be maximized ──
const phone = await open({ base: OFFLINE, viewport: { width: 390, height: 780 }, mobile: true, settle: 1500 });
const p = phone.page;
await installMovablePanel(p);
await p.locator('.vela-mb-more').click();
await p.waitForSelector('.vela-md-row', { timeout: 5000 });
await p.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => /Resize probe/i.test(r.textContent || ''))?.click());
await p.waitForSelector('.vela-panel.vela-panel-resizeProbe', { timeout: 5000 });
await p.waitForTimeout(300);

const rectOf = () => p.evaluate(() => {
    const panel = document.querySelector('.vela-panel.vela-panel-resizeProbe');
    return {
        top: panel?.getBoundingClientRect().top ?? 0,
        height: panel?.getBoundingClientRect().height ?? 0,
        sheetTop: panel?.dataset.sheetTop ?? null,
        max: panel?.dataset.maximized ?? null,
        overflow: document.documentElement.scrollWidth,
    };
});
const sheet = await rectOf();
assert(sheet.top > 40 && sheet.height < 700, 'phone panel is a bottom sheet, not fullscreen', sheet);
assert((await p.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-move').count()) === 0, 'movement buttons are absent from the header');
assert((await p.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-max').isVisible()) === true, 'maximize button is still available');

// Click the grip: no value popup. Keyboard resize still works without a drag.
const grip = p.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-grip');
await grip.click();
assert(await p.locator('.vela-panel-height-control,.vela-panel-position-control').count() === 0,
    'clicking the grip opens no size popup');
await grip.focus();
await p.keyboard.press('Shift+ArrowUp');
await p.waitForTimeout(180);
const expanded = await rectOf();
assert(expanded.height > sheet.height + 70 && expanded.top < sheet.top - 70, 'keyboard expands without a drag', { sheet, expanded });
await p.keyboard.press('ArrowDown');
await p.waitForTimeout(180);
const shortened = await rectOf();
assert(shortened.height < expanded.height - 20 && shortened.top > expanded.top + 20, 'keyboard changes the height with the bottom anchored', { expanded, shortened });

// Hold the title itself, not a dedicated movement button, and drag it up.
const head = await p.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-title').boundingBox();
assert(!!head, 'the panel title can be grabbed', head);
await p.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
await p.mouse.down();
await p.mouse.move(head.x + head.width / 2, head.y + head.height / 2 - 90, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(220);
const dragged = await rectOf();
assert(Math.abs(dragged.top - shortened.top) < 2 && Math.abs(dragged.height - shortened.height) < 2,
    'dragging a phone heading leaves the attached pane unchanged', { shortened, dragged });

await p.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-header').focus();
await p.keyboard.press('ArrowUp');
await p.waitForTimeout(180);
const keyboardTop = await rectOf();
assert(Math.abs(keyboardTop.top - dragged.top) < 2 && Math.abs(keyboardTop.height - dragged.height) < 2, 'keyboard heading movement is disabled for phone panes', { dragged, keyboardTop });

await p.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-max').click();
await p.waitForTimeout(180);
const max = await rectOf();
assert(max.max === '1' && max.top < keyboardTop.top, 'maximize fills the phone dock', max);
await p.locator('.vela-panel.vela-panel-resizeProbe .vela-panel-max').click();
await p.waitForTimeout(180);
const restored = await rectOf();
assert(restored.max === null && restored.top > 0, 'restore returns to the chosen sheet size', restored);
assert(restored.overflow <= 390, 'no horizontal overflow', restored.overflow);
assert(phone.errors.length === 0, 'no phone page errors', phone.errors.slice(0, 3));
await phone.browser.close();

report('panel-movement', { desktopBefore, desktopAfterWidth, maximized, floated, floatedAgain, sheet, expanded, shortened, dragged, keyboardTop, max, restored });
