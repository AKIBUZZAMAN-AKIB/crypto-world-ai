// Mobile bar — the two MIRROR stops (chart type · drawings), measured on the
// deterministic offline page at a phone viewport. The bar used to spend its widest fixed
// slot on the layout count and hard-coded a pencil for drawings; both now reflect the
// active cell, so the check is about TRUTH: every path that changes the state (tap, API,
// cell switch, keyboard-free arming) must repaint the stop, and the layout the bar gave
// up must still be one tap away inside the style sheet.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const facts = {};

const read = () =>
    page.evaluate(() => {
        const stop = document.querySelector('.vela-mb-style');
        const draw = document.querySelector('.vela-mb-drawings');
        const sheet = document.querySelector('.vela-cts');
        const ws = window.__ws;
        return {
            hasStyle: !!stop && stop.offsetWidth > 0,
            styleLabel: stop?.getAttribute('aria-label') ?? null,
            styleGlyph: stop?.querySelector('.vela-mb-glyph')?.innerHTML ?? null,
            styleH: stop ? Math.round(stop.getBoundingClientRect().height) : 0,
            expanded: stop?.getAttribute('aria-expanded') ?? null,
            drawLabel: draw?.getAttribute('aria-label') ?? null,
            drawGlyph: draw?.querySelector('.vela-mb-glyph')?.innerHTML ?? null,
            drawArmed: draw?.classList.contains('vela-mb-armed') ?? false,
            drawH: draw ? Math.round(draw.getBoundingClientRect().height) : 0,
            legacyLayoutStop: !!document.querySelector('.vela-mb-layout'),
            sheetOpen: !!sheet && sheet.getBoundingClientRect().width > 0,
            tiles: sheet ? [...sheet.querySelectorAll('.vela-cts-tile')].map((t) => ({ id: t.dataset.id, on: t.dataset.on === '1' })) : [],
            style: ws?.active?.priceStyle ?? null,
            tool: ws?.active?.chart?.drawings?.getTool?.() ?? null,
            scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

try {
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(1200);

    // ── the bar itself ──────────────────────────────────────────────────────────
    let m = await read();
    assert(m.hasStyle, 'the chart-type stop is live on the phone shell', m);
    assert(!m.legacyLayoutStop, 'the layout-count stop is gone from the bar', m);
    assert(m.styleH >= 44 && m.drawH >= 44, 'both mirror stops keep a 44px touch target', { style: m.styleH, draw: m.drawH });
    assert(m.styleLabel?.includes('Candles') === true, 'the stop names the active style (candles)', m.styleLabel);
    assert(m.drawLabel === 'Drawings' && m.drawArmed === false, 'an idle drawings stop shows the plain pencil', m.drawLabel);
    facts.idle = { styleLabel: m.styleLabel, drawLabel: m.drawLabel, style: m.style };

    // ── tap → sheet: one tile per style, the current one lit ────────────────────
    await page.locator('.vela-mb-style').tap();
    await page.waitForTimeout(300);
    m = await read();
    assert(m.sheetOpen, 'tapping the stop raises the chart-type sheet', m.sheetOpen);
    assert(m.expanded === 'true', 'the stop reports aria-expanded', m.expanded);
    assert(m.tiles.length >= 10, 'the sheet lists every registered style', m.tiles.length);
    assert(m.tiles.filter((t) => t.on).length === 1 && m.tiles.find((t) => t.on)?.id === m.style, 'exactly the active style is lit', m.tiles.filter((t) => t.on));
    facts.sheet = { tiles: m.tiles.length, lit: m.tiles.find((t) => t.on)?.id };

    // ── tap a tile → the workspace style changes and the stop repaints ──────────
    const before = m.styleGlyph;
    await page.locator('.vela-cts-tile[data-id="line"]').tap();
    await page.waitForTimeout(500);
    m = await read();
    assert(m.style === 'line', 'the pick reaches the active cell', m.style);
    assert(!m.sheetOpen, 'the sheet closes on a pick', m.sheetOpen);
    assert(m.styleGlyph !== before && m.styleLabel?.includes('Line') === true, 'the stop mirrors the new style', { glyphChanged: m.styleGlyph !== before, label: m.styleLabel });
    facts.pick = { style: m.style, label: m.styleLabel };

    // ── API path → the mirror is truthful without a tap ─────────────────────────
    await page.evaluate(() => window.__ws.active.setPriceStyle('renko'));
    await page.waitForTimeout(500);
    m = await read();
    assert(m.style === 'renko' && m.styleLabel?.includes('Renko') === true, 'an API style change repaints the stop', { style: m.style, label: m.styleLabel });

    // ── cell switch → the stop follows the NEW active cell ─────────────────────
    const other = await page.evaluate(() => {
        const ws = window.__ws;
        const next = ws.cells().find((c) => c.id !== ws.active.id);
        ws.setActiveCell(next.id);
        return { id: next.id, style: next.priceStyle };
    });
    await page.waitForTimeout(500);
    m = await read();
    assert(m.style === other.style, 'switching cells re-reads the active cell’s style', { cell: other.id, expected: other.style, got: m.style });

    // ── drawings: idle → armed tool → eraser → idle ─────────────────────────────
    await page.evaluate(() => window.__ws.active.chart.drawings.setTool('trendline'));
    await page.waitForTimeout(400);
    m = await read();
    assert(m.tool === 'trendline' && m.drawArmed, 'arming a tool lights the drawings stop', { tool: m.tool, label: m.drawLabel });
    assert(m.drawLabel?.startsWith('Drawing — '), 'the stop names the armed tool', m.drawLabel);
    const trendGlyph = m.drawGlyph;
    assert(trendGlyph !== null && trendGlyph.length > 0, 'the armed tool brings its own glyph', trendGlyph?.slice(0, 60));

    await page.evaluate(() => window.__ws.active.chart.drawings.setTool('hline'));
    await page.waitForTimeout(300);
    m = await read();
    assert(m.drawGlyph !== trendGlyph, 'switching the armed tool repaints the glyph', { now: m.drawLabel });

    await page.evaluate(() => window.__ws.active.chart.drawings.setTool(null));
    await page.waitForTimeout(300);
    m = await read();
    assert(!m.drawArmed && m.drawLabel === 'Drawings', 'disarming returns the plain pencil', m.drawLabel);

    await page.evaluate(() => window.__ws.active.chart.drawings.setMode('eraser'));
    await page.waitForTimeout(300);
    m = await read();
    assert(m.drawArmed && m.drawLabel?.includes('Eraser') === true, 'the eraser MODE mirrors too (it is not a tool)', m.drawLabel);
    await page.evaluate(() => window.__ws.active.chart.drawings.setMode(null));
    await page.waitForTimeout(300);
    facts.drawings = { idle: m.drawLabel };

    // ── the layout door the bar gave up: one row inside the sheet ──────────────
    await page.locator('.vela-mb-style').tap();
    await page.waitForTimeout(300);
    const row = await page.evaluate(() => {
        const el = document.querySelector('.vela-cts-layout');
        return el ? { label: el.getAttribute('aria-label'), text: el.textContent, w: Math.round(el.getBoundingClientRect().width) } : null;
    });
    assert(!!row, 'the sheet carries the layout row', row);
    assert(/\d+×\d+/.test(row?.label ?? ''), 'the layout row names the current grid', row?.label);
    await page.locator('.vela-cts-layout').tap();
    await page.waitForTimeout(600);
    m = await read();
    const lp = await page.evaluate(() => {
        // The drawer's layout view: its canvas + the preset strip (the picker the bar's
        // one-tap door used to raise is unchanged — only the door moved).
        const grid = document.querySelector('.vela-md-gridwrap .vela-lp-grid');
        const presets = [...document.querySelectorAll('.vela-md-preset')];
        const live = presets.filter((p) => p.getBoundingClientRect().width > 0);
        const r = grid?.getBoundingClientRect();
        return {
            grid: r ? { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) } : null,
            presets: live.length,
            first: live[0]?.getBoundingClientRect().width ?? 0,
        };
    });
    assert(!m.sheetOpen, 'the style sheet yields to the layout sheet', m.sheetOpen);
    assert(lp.grid && lp.grid.left >= 0 && lp.grid.right <= 391, 'the layout canvas stays inside the phone', lp.grid);
    assert(lp.presets >= 10 && lp.first >= 24, 'the preset strip is reachable from the sheet', lp);
    assert(m.scrollX <= 0, 'nothing pushes the page sideways', m.scrollX);
    facts.layout = { row: row?.label, ...lp };

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
} finally {
    await context.close();
    await browser.close();
    report('mobilebar', facts);
}
