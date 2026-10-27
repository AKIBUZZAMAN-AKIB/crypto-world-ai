// R86 T10 — docked panels are not stuck fullscreen. Desktop object tree/data window
// resize and maximize; phone panels are bottom sheets with up/down arrows, a drag
// grip, discrete keyboard movement and a maximize/restore control.
import { open, assert, report } from './helpers.mjs';

// ── Desktop: every built-in side panel has a width seam and a maximize verb ──
const desktop = await open({ viewport: { width: 1280, height: 820 }, settle: 1300 });
const d = desktop.page;
await d.locator('button[aria-label="Object tree"]').click();
await d.waitForSelector('.vela-panel.vela-ot', { timeout: 5000 });
const desktopBefore = await d.evaluate(() => {
    const panel = document.querySelector('.vela-panel.vela-ot');
    return {
        width: panel?.getBoundingClientRect().width ?? 0,
        resizer: !!panel?.querySelector('.vela-panel-resizer'),
        max: !!panel?.querySelector('.vela-panel-max'),
        grip: !!panel?.querySelector('.vela-panel-grip'),
        moves: panel?.querySelectorAll('.vela-panel-move').length ?? 0,
    };
});
assert(desktopBefore.resizer && desktopBefore.max, 'desktop object tree has resize and maximize controls', desktopBefore);
assert(desktopBefore.grip && desktopBefore.moves === 2, 'sheet controls are present but hidden on desktop', desktopBefore);
const gripBoxDesktop = await d.locator('.vela-panel.vela-ot .vela-panel-grip').boundingBox();
assert(gripBoxDesktop === null, 'mobile-only movement controls are not visible on desktop', gripBoxDesktop);

// Drag the inner edge: a wider panel, persisted through the dock.
const seam = await d.locator('.vela-panel.vela-ot .vela-panel-resizer').boundingBox();
assert(!!seam, 'the desktop resize seam has a hit box', seam);
await d.mouse.move(seam.x + seam.width / 2, seam.y + seam.height / 2);
await d.mouse.down();
await d.mouse.move(seam.x + seam.width / 2 - 70, seam.y + seam.height / 2, { steps: 8 });
await d.mouse.up();
await d.waitForTimeout(200);
const desktopAfterWidth = await d.evaluate(() => document.querySelector('.vela-panel.vela-ot')?.getBoundingClientRect().width ?? 0);
assert(desktopAfterWidth > desktopBefore.width + 40, 'dragging the seam widens the docked panel', { before: desktopBefore.width, after: desktopAfterWidth });
await d.locator('.vela-panel.vela-ot .vela-panel-max').click();
const maximized = await d.evaluate(() => ({
    flag: document.querySelector('.vela-panel.vela-ot')?.dataset.maximized ?? null,
    width: document.querySelector('.vela-panel.vela-ot')?.getBoundingClientRect().width ?? 0,
    host: document.querySelector('.vela-panel.vela-ot')?.parentElement?.getBoundingClientRect().width ?? 0,
}));
assert(maximized.flag === '1' && maximized.width >= maximized.host - 2, 'maximize covers the dock host', maximized);
await d.locator('.vela-panel.vela-ot .vela-panel-max').click();
assert(desktop.errors.length === 0, 'no desktop page errors', desktop.errors.slice(0, 3));
await desktop.browser.close();

// ── Phone: a bottom sheet that can be moved up/down, dragged and maximized ──
const phone = await open({ viewport: { width: 390, height: 780 }, mobile: true, settle: 1500 });
const p = phone.page;
await p.locator('.vela-mb-more').click();
await p.waitForSelector('.vela-md-row', { timeout: 5000 });
await p.evaluate(() => [...document.querySelectorAll('.vela-md-row')].find((r) => /Object tree/i.test(r.textContent || ''))?.click());
await p.waitForSelector('.vela-panel.vela-ot', { timeout: 5000 });
await p.waitForTimeout(300);

const rectOf = () => p.evaluate(() => {
    const panel = document.querySelector('.vela-panel.vela-ot');
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
assert((await p.locator('.vela-panel.vela-ot .vela-panel-move').count()) === 2, 'up/down movement buttons are visible', await p.locator('.vela-panel.vela-ot .vela-panel-move').count());
assert((await p.locator('.vela-panel.vela-ot .vela-panel-max').isVisible()) === true, 'maximize button is visible on mobile');

await p.locator('.vela-panel.vela-ot .vela-panel-move[data-dir="down"]').click();
await p.waitForTimeout(180);
const lower = await rectOf();
assert(lower.top > sheet.top + 20, 'Move panel down shortens the sheet', { sheet, lower });
await p.locator('.vela-panel.vela-ot .vela-panel-move[data-dir="up"]').click();
await p.waitForTimeout(180);
const higher = await rectOf();
assert(higher.top < lower.top - 20, 'Move panel up grows the sheet', { lower, higher });

const grip = await p.locator('.vela-panel.vela-ot .vela-panel-grip').boundingBox();
assert(!!grip, 'the drag grip has a hit box', grip);
await p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await p.mouse.down();
await p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 90, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(220);
const dragged = await rectOf();
assert(dragged.top > higher.top + 30, 'dragging the grip down moves the whole sheet', { higher, dragged });

await p.locator('.vela-panel.vela-ot .vela-panel-grip').focus();
await p.keyboard.press('ArrowUp');
await p.waitForTimeout(180);
const keyboardTop = await rectOf();
assert(keyboardTop.top < dragged.top - 20 && keyboardTop.top > 0, 'keyboard Arrow movement works without losing a sheet size', { dragged, keyboardTop });

await p.locator('.vela-panel.vela-ot .vela-panel-max').click();
await p.waitForTimeout(180);
const max = await rectOf();
assert(max.max === '1' && max.top < keyboardTop.top, 'maximize fills the phone dock', max);
await p.locator('.vela-panel.vela-ot .vela-panel-max').click();
await p.waitForTimeout(180);
const restored = await rectOf();
assert(restored.max === null && restored.top > 0, 'restore returns to the chosen sheet size', restored);
assert(restored.overflow <= 390, 'no horizontal overflow', restored.overflow);
assert(phone.errors.length === 0, 'no phone page errors', phone.errors.slice(0, 3));
await phone.browser.close();

report('panel-movement', { desktopBefore, desktopAfterWidth, maximized, sheet, lower, higher, dragged, keyboardTop, max, restored });
