// The layout menu (R55): the name chip after undo/redo, and the panel it opens.
//
// jsdom (test/layout-menu.test.ts) proves the model contract; only Chromium can prove the
// things that make this TradingView-grade: the chip sits in the toolbar's own row, the
// panel is a real floating surface INSIDE the viewport, the unsaved dot appears on its own
// after a real chart edit, the clipboard actually receives a share link, and no width of
// desktop window lets the name push the page sideways.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const facts = {};

const state = () =>
    page.evaluate(() => ({
        chip: document.querySelector('.vela-widget-layoutname-text')?.textContent ?? null,
        chipAria: document.querySelector('.vela-widget-layoutname')?.getAttribute('aria-label') ?? null,
        dot: document.querySelector('.vela-layout-dot') ? document.querySelector('.vela-layout-dot').hidden === false : null,
        saveDirty: document.querySelector('.vela-widget-layoutsave')?.dataset.dirty === '1',
        saved: window.__ws.savedLayoutList().map((l) => `${l.name}${l.active ? '*' : ''}${l.dirty ? '!' : ''}`),
        autosave: window.__ws.autosaveEnabled(),
    }));

const openPanel = async () => {
    // Idempotent: some verbs leave the panel open (autosave, delete, a rename's error), and
    // the chip TOGGLES, so a blind click would shut it again.
    if (await page.locator('.vela-lm').count()) return;
    await page.locator('.vela-widget-layoutname').click();
    await page.waitForSelector('.vela-lm', { timeout: 5000 });
};
const closePanel = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.vela-lm'), null, { timeout: 5000 });
};
const verb = async (prefix) => {
    await page.evaluate((p) => {
        [...document.querySelectorAll('.vela-lm-row')].find((r) => r.textContent.trim().startsWith(p))?.click();
    }, prefix);
    await page.waitForSelector('.vela-lm-input', { timeout: 5000 });
};
const commit = async (name) => {
    await page.fill('.vela-lm-input', name);
    await page.evaluate(() => document.querySelector('.vela-lm-btn[data-primary]').click());
    await page.waitForTimeout(350);
};

try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1200);

    // ── 1. the chip lives after undo/redo ────────────────────────────────────────
    const order = await page.evaluate(() =>
        [...document.querySelectorAll('.vela-widget-topbar > *')].map((el) =>
            el.classList.contains('vela-widget-undo') ? 'undo' : el.classList.contains('vela-widget-redo') ? 'redo' : el.classList.contains('vela-widget-layoutgroup') ? 'chip' : '',
        ).filter(Boolean),
    );
    assert(JSON.stringify(order) === JSON.stringify(['undo', 'redo', 'chip']), 'the name chip follows undo/redo', order);
    let s = await state();
    assert(s.chip === 'Untitled layout', 'an unsaved workspace says so', s);
    assert(s.dot === false, 'no unsaved dot before anything is saved', s);

    // ── 2. the panel is a real surface inside the viewport ──────────────────────
    await openPanel();
    const box = await page.evaluate(() => {
        const el = document.querySelector('.vela-lm');
        const r = el.getBoundingClientRect();
        const bg = getComputedStyle(el).backgroundColor;
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg, vw: innerWidth, vh: innerHeight, rows: el.querySelectorAll('.vela-lm-row').length };
    });
    assert(box.x >= 0 && box.y >= 0 && box.x + box.w <= box.vw && box.y + box.h <= box.vh, 'the panel fits on screen', box);
    assert(box.rows === 5, 'five verbs, as TradingView lists them', box.rows);
    // An opaque surface: a menu you can read the chart through is not a menu.
    assert(!/rgba\(0, 0, 0, 0\)|transparent/.test(box.bg), 'the panel paints its own surface', box.bg);
    facts.panel = box;
    await closePanel();

    // ── 3. Save with no name: one dialog, then the chip carries it ──────────────
    await openPanel();
    await page.evaluate(() => document.querySelector('.vela-lm-primary').click());
    await page.waitForSelector('.vela-lm-input', { timeout: 5000 });
    const prefill = await page.inputValue('.vela-lm-input');
    assert(prefill === 'Untitled layout', 'the field offers a name to edit', prefill);
    await commit('Desk A');
    s = await state();
    assert(s.chip === 'Desk A' && s.saved.some((l) => l === 'Desk A*'), 'the chip wears the new name', s);
    assert(s.saveDirty === false, 'and no unsaved dot right after the write', s);

    // ── 4. a real chart edit raises the dot on its own ──────────────────────────
    await page.evaluate(() => window.__ws.active.setSymbol('SOLUSDT'));
    await page.waitForTimeout(900); // the chip's trailing repaint, not a push
    s = await state();
    assert(s.dot === true && s.saveDirty === true, 'an edit lights the unsaved dot by itself', s);
    assert(s.chipAria?.includes('unsaved changes'), 'and the name says it too', s.chipAria);
    await page.locator('.vela-widget-layoutsave').click();
    await page.waitForTimeout(500);
    s = await state();
    assert(s.dot === false && s.saved.includes('Desk A*'), 'the chip save button overwrites the open layout', s);

    // ── 5. Make a copy: named, listed, NOT opened ───────────────────────────────
    await openPanel();
    await verb('Make a copy');
    await commit('Desk B');
    s = await state();
    assert(s.saved.includes('Desk A*') && s.saved.includes('Desk B'), 'the copy lands beside the original', s.saved);
    assert(s.chip === 'Desk A', 'and the open layout does not change under the trader', s.chip);

    // ── 6. rename through the row's kebab; the duplicate name is refused ────────
    await openPanel();
    await page.evaluate(() => {
        const row = [...document.querySelectorAll('.vela-lm-srow')].find((r) => r.textContent.includes('Desk B'));
        row.querySelector('.vela-lm-kebab').click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => [...document.querySelectorAll('.vela-lm-act')].find((b) => b.textContent === 'Rename…').click());
    await page.waitForSelector('.vela-lm-input', { timeout: 5000 });
    await page.fill('.vela-lm-input', 'Desk A');
    await page.evaluate(() => document.querySelector('.vela-lm-btn[data-primary]').click());
    await page.waitForTimeout(250);
    const err = await page.textContent('.vela-lm-err');
    assert(/already exists/.test(err ?? ''), 'a taken name is refused in place', err);
    await commit('Desk B renamed');
    s = await state();
    assert(s.saved.includes('Desk B renamed') && !s.saved.includes('Desk B'), 'the rename replaced the row', s.saved);

    // ── 7. delete is two taps, inside the row it destroys ───────────────────────
    // A throwaway copy, so the layout the next step opens is still there afterwards.
    await openPanel();
    await verb('Make a copy');
    await commit('Trash me');
    await openPanel();
    await page.evaluate(() => {
        const row = [...document.querySelectorAll('.vela-lm-srow')].find((r) => r.textContent.includes('Trash me'));
        row.querySelector('.vela-lm-kebab').click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => [...document.querySelectorAll('.vela-lm-act')].find((b) => b.textContent === 'Delete').click());
    await page.waitForTimeout(200);
    let afterOne = (await state()).saved;
    assert(afterOne.includes('Trash me'), 'one tap arms, it does not delete', afterOne);
    const confirmLabel = await page.evaluate(() => [...document.querySelectorAll('.vela-lm-act')].find((b) => b.textContent.startsWith('Delete'))?.textContent);
    assert(/confirm/.test(confirmLabel ?? ''), 'the second tap says what it will do', confirmLabel);
    await page.evaluate(() => [...document.querySelectorAll('.vela-lm-act')].find((b) => b.textContent.startsWith('Delete')).click());
    await page.waitForTimeout(300);
    s = await state();
    assert(!s.saved.includes('Trash me'), 'the second tap deletes it', s.saved);
    assert(s.saved.includes('Desk B renamed'), 'and leaves the other rows alone', s.saved);

    // ── 8. autosave, share, and open-from-the-list ──────────────────────────────
    await openPanel();
    await page.evaluate(() => document.querySelector('.vela-lm-switch').click());
    await page.waitForTimeout(300);
    s = await state();
    assert(s.autosave === true, 'the switch reaches the workspace', s);
    assert((await page.getAttribute('.vela-lm-switch', 'aria-checked')) === 'true', 'and the switch repaints');

    await page.evaluate(() => [...document.querySelectorAll('.vela-lm-row')].find((r) => r.textContent.startsWith('Share')).click());
    await page.waitForFunction(() => document.querySelector('.vela-lm-state')?.textContent?.includes('Link copied'), null, { timeout: 5000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // A named layout shares as a LAYOUT link (#l1=…): the same codec as a whole-workspace
    // link, carrying this one snapshot.
    assert(/#(s[01]|l1)=/.test(clip), 'the clipboard carries the share link', clip.slice(0, 40));

    // A row opens its layout; the check follows.
    await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.vela-lm-srow')];
        rows.find((r) => !r.hasAttribute('data-active'))?.querySelector('.vela-lm-smain').click();
    });
    await page.waitForTimeout(600);
    s = await state();
    assert(s.chip === 'Desk B renamed', 'the list opens the layout it names', s);
    assert(!(await page.locator('.vela-lm').count()), 'and the panel closes on that verb');

    // ── 9. Escape hands focus back to the chip ──────────────────────────────────
    await openPanel();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.vela-lm'), null, { timeout: 5000 });
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    assert(focused.includes('vela-widget-layoutname'), 'focus returns to the chip', focused);

    // ── 10. no desktop width lets the name push the page sideways ───────────────
    const widths = {};
    for (const width of [1440, 1024, 820]) {
        await page.setViewportSize({ width, height: 820 });
        await page.waitForTimeout(350);
        widths[width] = await page.evaluate(() => {
            const chip = document.querySelector('.vela-widget-layoutname')?.getBoundingClientRect();
            return { chipW: chip ? Math.round(chip.width) : 0, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        assert(widths[width].over <= 0, `${width}: the layout name never widens the page`, widths[width]);
        assert(widths[width].chipW >= 44, `${width}: the chip keeps a usable target`, widths[width]);
    }
    facts.widths = widths;

    facts.final = await state();
    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
} finally {
    await context.close();
    await browser.close();
    report('layout-menu', facts);
}
