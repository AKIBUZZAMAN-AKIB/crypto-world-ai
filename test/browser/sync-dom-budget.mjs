// R61 — the DOM BUDGET. Chrome that is not on screen must not cost nodes.
//
// The audit found 74% of the boot tree was invisible: twelve closed menus carried 372
// rows, every cell mounted a full 157-node drawing rail it never showed (the workspace
// owns the real one), and the phone shell's bar sat fully built under a desktop layout.
// This check holds the line: it counts what a fresh page really costs, proves the rows
// arrive when they are asked for, and fails if the tree grows back.
import { BASE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

/** Ceilings with headroom — the point is "a few hundred, not a couple of thousand". */
const BUDGET = { desktop: 1450, phone: 1400 };
/** What a fresh 4-cell workspace used to cost before the audit (for the record). */
const BEFORE = { desktop: 2302, phone: 1794 };

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = {};

const boot = async (width, height, mobile) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await context.newPage();
    await page.addInitScript(() => {
        window.__ls = 0;
        const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (...a) {
            window.__ls += 1;
            return add.apply(this, a);
        };
    });
    page.on('pageerror', (e) => errors.push(`${width}: ${e}`));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1800);
    return { context, page };
};

const census = (page) =>
    page.evaluate(() => {
        const rails = [...document.querySelectorAll('.vela-dtb')].map((d) => d.querySelectorAll('*').length);
        return {
            nodes: document.querySelectorAll('*').length,
            listeners: window.__ls,
            menuRows: document.querySelectorAll('.vela-menu-item').length,
            menus: document.querySelectorAll('.vela-menu').length,
            rails: { total: rails.length, built: rails.filter((n) => n > 20).length, biggest: Math.max(...rails, 0) },
            canvases: document.querySelectorAll('canvas').length,
            cells: window.__ws.cells().length,
            features: {
                topbar: !!document.querySelector('.vela-widget-topbar'),
                mobilebar: !!document.querySelector('.vela-mobilebar'),
                legendRows: document.querySelectorAll('[data-vela-pane="price"] > *').length,
                drawingRail: !!document.querySelector('.vela-ws-toolbar .vela-dtb'),
                bottombar: !!document.querySelector('.vela-widget-bottombar'),
            },
        };
    });

try {
    // ── 1. a desktop boot costs the budget, and keeps every feature ───────────────
    {
        const { context, page } = await boot(1440, 900, false);
        const m = await census(page);
        facts.desktop = { ...m, before: BEFORE.desktop };
        assert(m.nodes <= BUDGET.desktop, `desktop boot stays inside the ${BUDGET.desktop}-node budget`, { nodes: m.nodes, before: BEFORE.desktop });
        assert(m.nodes < BEFORE.desktop * 0.75, 'and is at least a quarter lighter than the audited tree', { nodes: m.nodes, before: BEFORE.desktop });
        assert(m.listeners < 1600, 'listener count is roughly halved too', m.listeners);
        assert(m.menuRows === 0, 'no closed menu holds its rows', { menus: m.menus, rows: m.menuRows });
        assert(m.rails.built === 1, 'exactly ONE drawing rail is built (the workspace\'s shared bar)', m.rails);
        assert(m.features.drawingRail && m.features.topbar && m.features.legendRows >= 1 && m.features.bottombar, 'every surface is still there', m.features);
        assert(m.canvases === 29 && m.cells === 4, 'the charts are untouched (4 cells, 29 canvases)', { canvases: m.canvases, cells: m.cells });

        // The rows arrive when a menu is opened — laziness is not a missing feature.
        await page.click('.vela-widget-tf-caret');
        await page.waitForTimeout(400);
        const opened = await page.evaluate(() => {
            const m = [...document.querySelectorAll('.vela-menu')].find((x) => x.getBoundingClientRect().height > 20);
            return m ? { rows: m.querySelectorAll('.vela-menu-item').length, top: Math.round(m.getBoundingClientRect().top), labels: [...m.querySelectorAll('.vela-menu-label')].slice(0, 3).map((l) => l.textContent) } : null;
        });
        facts.desktopMenu = opened;
        assert(opened && opened.rows >= 6, 'opening the timeframe menu builds its rows', opened);
        assert(opened.labels.length === 3 && opened.top < 80, '…with their labels, anchored under the caret', opened);

        // The rail that IS on screen is built in full — laziness never leaves a
        // half-drawn toolbar behind.
        assert(m.rails.biggest >= 100, 'the visible drawing rail keeps all of its tools', m.rails);

        await context.close();
    }

    // ── 2. a phone boot: the shell that is not shown is not built ─────────────────
    {
        const { context, page } = await boot(390, 780, true);
        const m = await census(page);
        facts.phone = { ...m, before: BEFORE.phone };
        assert(m.nodes <= BUDGET.phone, `phone boot stays inside the ${BUDGET.phone}-node budget`, { nodes: m.nodes, before: BEFORE.phone });
        assert(m.nodes < BEFORE.phone * 0.8, 'and is materially lighter than the audited tree', { nodes: m.nodes, before: BEFORE.phone });
        assert(m.menuRows === 0, 'phone: no closed menu holds its rows', m.menus);
        assert(m.features.mobilebar && m.features.legendRows >= 1, 'phone: its own bar and legend are still there', m.features);
        assert(m.rails.built === 1 && m.rails.biggest >= 100, 'phone: one full drawing rail, the rest unbuilt', m.rails);
        await context.close();
    }

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-dom-budget', facts);
} finally {
    await browser.close();
}
