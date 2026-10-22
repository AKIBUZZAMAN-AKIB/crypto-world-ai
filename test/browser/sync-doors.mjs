// The two doors into chart syncing on a desktop: the status-line badge and the series
// context menu. Both must land on the table with THIS chart's column in view — jsdom can
// build the DOM, only a real browser proves the click chain.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
try {
    // An unmarked chart still shows the badge (empty ring): the door exists before any group.
    const empty = await page.evaluate(() => [...document.querySelectorAll('.vela-sl-marks')].map((e) => ({ text: e.textContent, hidden: e.hidden })));
    assert(empty.length >= 4 && empty.every((b) => !b.hidden && b.text === '◌'), 'every chart wears the empty badge', empty);

    // Badge → popover, focused on that chart's column.
    const target = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.vela-sl-marks')];
        const el = cells[cells.length - 1];
        el.click();
        return window.__ws.syncCharts().at(-1)?.id ?? null;
    });
    await page.waitForTimeout(400);
    const badgeOpen = await page.evaluate(() => ({
        open: window.__ws.topbar?.layoutPicker?.isOpen ?? null,
        focus: document.querySelector('.vela-lp-charts .vela-md-matrix-head[data-focus]')?.dataset.cell ?? null,
        numbers: document.querySelector('[data-sync-open]') !== null,
    }));
    assert(badgeOpen.open === true, 'badge opens the layout popover', badgeOpen);
    assert(badgeOpen.focus === target, 'the popover opens on THAT chart', { ...badgeOpen, target });
    assert(badgeOpen.numbers, 'charts wear their slot numbers while the surface is open', badgeOpen);

    // Series context menu → "Chart syncing…" opens the same surface.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const host = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.vela-cell')].find((c) => c.getBoundingClientRect().width > 200) ?? document.body;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    await page.mouse.click(host.x, host.y, { button: 'right' });
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => {
        const menus = [...document.querySelectorAll('.vela-menu')].filter((m) => m.getBoundingClientRect().height > 0);
        const top = menus[menus.length - 1];
        return top ? [...top.querySelectorAll('.vela-menu-item')].map((i) => i.textContent?.trim()) : [];
    });
    const idx = rows.findIndex((t) => t?.startsWith('Chart syncing'));
    assert(idx >= 0, 'the context menu carries Chart syncing…', rows);
    const spot = await page.evaluate((i) => {
        const menus = [...document.querySelectorAll('.vela-menu')].filter((m) => m.getBoundingClientRect().height > 0);
        const el = menus[menus.length - 1].querySelectorAll('.vela-menu-item')[i];
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, idx);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(500);
    const viaMenu = await page.evaluate(() => ({
        open: window.__ws.topbar?.layoutPicker?.isOpen ?? null,
        focus: document.querySelector('.vela-lp-charts .vela-md-matrix-head[data-focus]')?.dataset.cell ?? null,
    }));
    assert(viaMenu.open === true && Boolean(viaMenu.focus), 'the menu row opens the table on that chart', viaMenu);
    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-doors', { badge: badgeOpen, menu: viaMenu });
} finally {
    await browser.close();
}
