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
const BUDGET = { desktop: 540, phone: 390 };
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
            // Body elements — the same count the audit reports (head's styles/scripts are
            // not the UI's weight).
            nodes: document.body.querySelectorAll('*').length,
            listeners: window.__ls,
            menuRows: document.querySelectorAll('.vela-menu-item').length,
            menus: document.querySelectorAll('.vela-menu').length,
            menuLayers: document.querySelectorAll('.vela-ui-layer[data-scope="menu"]').length,
            rails: { total: rails.length, built: rails.filter((n) => n > 20).length, biggest: Math.max(...rails, 0) },
            canvases: document.querySelectorAll('canvas').length,
            cellButtons: document.querySelectorAll('.vela-cc-btn').length,
            legendButtons: document.querySelectorAll('.vela-ind-ctl, .vela-ind-close').length,
            tooltips: document.querySelectorAll('.vela-tooltip').length,
            axisChips: document.querySelectorAll('.vela-axis-btn').length,
            stateBound: document.querySelectorAll('.vela-watermark-replay, .vela-sl-replay-badge, .vela-sl-eye, button[aria-label="Scroll to most recent bar"]').length,
            gridCanvases: document.querySelectorAll('.vela-ws-grid canvas').length,
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
        assert(m.listeners < 1300, 'listener count is roughly halved too', m.listeners);
        assert(m.menuRows === 0, 'no closed menu holds its rows', { menus: m.menus, rows: m.menuRows });
        assert(m.menus === 0 && m.menuLayers === 0, 'and a menu nobody has opened has no layer in the page at all', { menus: m.menus, layers: m.menuLayers });
        assert(m.cellButtons === 0, 'no chart carries a control cluster nobody has hovered for', m.cellButtons);
        assert(m.legendButtons === 0, 'and no legend row carries its action cluster before it is revealed', m.legendButtons);
        assert(m.tooltips === 0, 'and the shell carries ONE shared tooltip surface — built by the first hover', m.tooltips);
        assert(m.stateBound === 0, 'and nothing that belongs to a replay, a scroll-back or a hidden chart is built', m.stateBound);
        assert(m.axisChips === 0, 'no price scale carries its A/L chips before a cursor has hovered it', m.axisChips);
        assert(m.rails.built === 1, 'exactly ONE drawing rail is built (the workspace\'s shared bar)', m.rails);
        assert(m.features.drawingRail && m.features.topbar && m.features.legendRows >= 1 && m.features.bottombar, 'every surface is still there', m.features);
        assert(m.gridCanvases === 28 && m.cells === 4, 'the charts are untouched (4 cells, 28 chart canvases)', { canvases: m.gridCanvases, cells: m.cells });

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

        // A legend row's controls arrive when the row is revealed — and arrive COMPLETE.
        const title = await page.evaluate(() => {
            const el = [...document.querySelectorAll('[data-vela-pane="price"] *')].find((e) => e.textContent?.trim() === 'Volume');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        assert(title !== null, 'the legend has a row to reveal', title);
        if (title) {
            await page.mouse.move(title.x, title.y, { steps: 4 });
            await page.waitForTimeout(250);
            const cluster = await page.evaluate(() => ({
                labels: [...document.querySelectorAll('.vela-ind-ctl, .vela-ind-close')].map((b) => b.getAttribute('aria-label')),
                shown: [...document.querySelectorAll('.vela-ind-ctl, .vela-ind-close')].filter((b) => b.getBoundingClientRect().width > 0).length,
            }));
            facts.legendCluster = cluster;
            assert(cluster.labels.includes('Hide') && cluster.labels.includes('Settings') && cluster.labels.includes('Remove indicator'), 'the hovered row has its full verb set', cluster.labels);
            assert(cluster.shown >= 3, '…and they are actually out on screen', cluster);
        }

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
        // The desktop chrome is not merely hidden on a phone — it is not in the document.
        assert(!m.features.topbar && !m.features.drawingRail && !m.features.bottombar, 'phone: no desktop chrome is carried', m.features);

        // …and it comes back, correctly placed and working, when the layout becomes desktop.
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(800);
        const flipped = await page.evaluate(() => {
            const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; };
            return { layout: document.querySelector('[data-layout]')?.dataset.layout, topbar: box('.vela-widget-topbar'), rail: box('.vela-ws-toolbar'), bottombar: box('.vela-widget-bottombar'), mobilebar: box('.vela-mobilebar') };
        });
        facts.flipToDesktop = flipped;
        assert(flipped.layout === 'desktop' && flipped.topbar && flipped.topbar.w > 600 && flipped.topbar.top === 0, 'flip: the top bar comes back, full width, at the top', flipped);
        assert(flipped.rail && flipped.rail.w > 20 && flipped.bottombar && flipped.bottombar.w > 600, 'flip: the drawing rail and the bottom bar come back too', flipped);
        assert(!flipped.mobilebar || flipped.mobilebar.w === 0, 'flip: the phone bar steps aside', flipped);
        await page.click('.vela-widget-tf-caret');
        await page.waitForTimeout(350);
        const menuAfterFlip = await page.evaluate(() => [...document.querySelectorAll('.vela-menu')].map((m) => m.querySelectorAll('.vela-menu-item').length).filter((n) => n > 0));
        facts.flipMenu = menuAfterFlip;
        assert(menuAfterFlip.length === 1 && menuAfterFlip[0] >= 6, 'flip: the restored bar still opens its menus', menuAfterFlip);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        // …and going back to the phone takes it out again.
        await page.setViewportSize({ width: 390, height: 780 });
        await page.waitForTimeout(800);
        const back = await page.evaluate(() => ({ topbar: !!document.querySelector('.vela-widget-topbar'), rail: !!document.querySelector('.vela-ws-toolbar'), mobilebar: !!document.querySelector('.vela-mobilebar') }));
        facts.flipBack = back;
        assert(!back.topbar && !back.rail && back.mobilebar, 'flip back: the desktop chrome leaves again, the phone bar stays', back);
        // The phone draws with its own dock (the pill above the bottom bar), not the
        // desktop rail — which is not in the document at all.
        assert(m.rails.built === 0, 'phone: no desktop drawing rail is carried', m.rails);
        await context.close();
    }

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-dom-budget', facts);
} finally {
    await browser.close();
}
