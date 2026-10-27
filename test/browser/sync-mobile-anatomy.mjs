// The phone bar's ANATOMY, measured (R54): two fixed zones and one scrolling band.
//
//   [ BTCUSDT ⌄ ] │ 1h  ▮style  ✎draw  ⤢  ƒx  {} │ ⋯①  ⚙
//
// What this check refuses to let regress: at 320px the PAIR and the two doors out of the
// bar (More, Settings) are still fully on screen, with 44px targets; the tools between
// them scroll (with an edge fade, and nothing hidden for being narrow — the old bar hid
// the maximize stop under 380px); the page itself never pans; and the More stop's badge
// counts the charts a smaller layout parked, which the More sheet then lists BY NAME and
// can bring back with a tap.
import { OFFLINE, assert, report } from './helpers.mjs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const facts = {};

const WIDTHS = [320, 360, 390, 430];

const read = (page) =>
    page.evaluate(() => {
        const rect = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), hidden: el.hidden === true || r.width === 0 };
        };
        const band = document.querySelector('.vela-mb-scroll');
        const stops = [...document.querySelectorAll('.vela-mb-scroll > *')].map((el) => el.className.replace(/\bvela-mb-item\b/g, '').trim());
        return {
            bar: rect('.vela-mobilebar'),
            symbol: rect('.vela-mb-symbol'),
            more: rect('.vela-mb-more'),
            settings: rect('.vela-mb-settings'),
            trail: rect('.vela-mb-trail'),
            band: band ? { scroll: band.scrollWidth, client: band.clientWidth, left: band.scrollLeft } : null,
            edge: document.querySelector('.vela-mobilebar')?.dataset.edge ?? null,
            stops,
            chips: ['.vela-mb-tf', '.vela-mb-style', '.vela-mb-drawings', '.vela-mb-maximize', '.vela-mb-indicators', '.vela-mb-editor'].map((sel) => ({ sel, ...(rect(sel) ?? {}) })),
            inner: window.innerWidth,
            over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

try {
    // ── 1. every phone width: the fixed zones stay, the band scrolls ──────────────
    for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push(`${width}: ${e}`));
        await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
        await page.waitForTimeout(900);

        const m = await read(page);
        facts[width] = m;

        assert(m.bar && m.bar.h >= 44, `${width}: the bar is a real target row`, m.bar);
        // The pair — always on screen, never clipped by the band.
        assert(m.symbol && !m.symbol.hidden && m.symbol.x >= 0 && m.symbol.r <= m.inner, `${width}: the pair is fully on screen`, m.symbol);
        assert(m.symbol && m.symbol.w >= 84, `${width}: the pair keeps a readable floor`, m.symbol);
        // The two doors — always on screen, both 44px.
        for (const key of ['more', 'settings']) {
            const z = m[key];
            assert(z && !z.hidden && z.x >= 0 && z.r <= m.inner, `${width}: ${key} is fully on screen`, z);
            assert(z && z.w >= 44 && z.h >= 44, `${width}: ${key} is a 44px thumb target`, z);
        }
        // The pair's right edge never crosses the trail's left edge (the band sits between).
        assert(m.symbol.r <= m.trail.x, `${width}: the zones do not overlap`, { symbol: m.symbol, trail: m.trail });
        // Every tool in the band keeps its 44px height, and the maximize stop is NOT
        // hidden for being narrow (it scrolls instead).
        for (const chip of m.chips) {
            // An absent stop (the shell has no script editor ⇒ no editor chip) has no box.
            if (!chip || chip.w === undefined || chip.hidden) continue;
            assert(chip.h >= 44 && chip.w >= 44, `${width}: ${chip.sel} keeps a 44px target`, chip);
        }
        assert(m.chips[3] && !m.chips[3].hidden, `${width}: full/short screen is still in the band`, m.chips[3]);
        // The band scrolls where it must, and the fade says so.
        assert(m.band && m.band.scroll >= m.band.client, `${width}: the band holds its tools`, m.band);
        if (width <= 390) assert(m.band.scroll > m.band.client, `${width}: the band scrolls rather than squeezing`, m.band);
        if (m.band.scroll > m.band.client) assert(m.edge === 'end', `${width}: the right edge fades while there is more`, { edge: m.edge, band: m.band });
        else assert(m.edge === 'none', `${width}: no fade when everything fits`, { edge: m.edge, band: m.band });
        // The band's order is the decided reading order.
        // The decided reading order. The editor stop only exists when the host has a
        // scripting engine (this workspace passes `onEditor` only then), and the actions
        // host always closes the band; so compare the required spine, and require the
        // editor — when present — to sit exactly between indicators and the actions host.
        // R85: undo/redo are state-bound stops in the HEAD of the scrolling band, one
        // stop off the chart type (before drawings) — see mobile-bar-anatomy.test.ts.
        // The workspace wires them, so they are part of the required spine here.
        const spine = m.stops.filter((c) => c !== 'vela-mb-actions');
        const hasEditor = spine.includes('vela-mb-editor');
        const hasUndo = spine.includes('vela-mb-undo');
        const hasRedo = spine.includes('vela-mb-redo');
        const wanted = [
            'vela-mb-tf', 'vela-mb-style',
            ...(hasUndo ? ['vela-mb-undo'] : []),
            ...(hasRedo ? ['vela-mb-redo'] : []),
            'vela-mb-drawings', 'vela-mb-maximize', 'vela-mb-indicators',
            ...(hasEditor ? ['vela-mb-editor'] : []),
        ];
        assert(JSON.stringify(spine) === JSON.stringify(wanted), `${width}: tools in reading order`, m.stops);
        assert(m.stops[m.stops.length - 1] === 'vela-mb-actions', `${width}: the band ends with the host's own actions`, m.stops);
        // The page never pans.
        assert(m.over <= 1, `${width}: no horizontal page scroll`, { over: m.over });

        // Scrolling the band to its end flips the fade to the other edge.
        if (m.band.scroll > m.band.client) {
            const scrolled = await page.evaluate(async () => {
                const band = document.querySelector('.vela-mb-scroll');
                band.scrollLeft = band.scrollWidth;
                await new Promise((r) => setTimeout(r, 120));
                return { edge: document.querySelector('.vela-mobilebar')?.dataset.edge, left: Math.round(band.scrollLeft) };
            });
            assert(scrolled.edge === 'start', `${width}: the fade flips once the band is scrolled`, scrolled);
        }

        // The keyboard walks the band (one tab stop, arrows inside it).
        const keys = await page.evaluate(async () => {
            const band = document.querySelector('.vela-mb-scroll');
            const first = band.querySelector('button');
            first.focus();
            return { start: document.activeElement?.className ?? '' };
        });
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(120);
        const moved = await page.evaluate(() => document.activeElement?.className ?? '');
        assert(keys.start !== moved && moved.includes('vela-mb-'), `${width}: ArrowRight moves along the band`, { from: keys.start, to: moved });

        await context.close();
    }

    // ── 2. hidden charts: the badge, the list, and bringing one back ───────────────
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`hidden: ${e}`));
    await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(900);

    const prepared = await page.evaluate(async () => {
        const ws = window.__ws;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        ws.setLayout('4');
        await wait(900);
        const ids = ws.cells().map((c) => c.id);
        const wanted = ['XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LTCUSDT'];
        ids.forEach((id, i) => {
            ws.cell(id).setSymbol(wanted[i]);
            ws.cell(id).setTimeframe(['5', '30', '120', 'D'][i]);
        });
        await wait(1400);
        ws.setLayout('1'); // three charts park
        await wait(900);
        const badge = document.querySelector('.vela-mb-more .vela-mb-badge');
        return {
            live: ws.cells().length,
            hidden: ws.hiddenChartCount,
            list: ws.hiddenChartList().map((h) => `${h.symbol}|${h.timeframe}`),
            badge: badge && !badge.hidden ? badge.textContent : null,
            moreLabel: document.querySelector('.vela-mb-more')?.getAttribute('aria-label'),
        };
    });
    assert(prepared.live === 1 && prepared.hidden === 3, 'a smaller layout parks three charts', prepared);
    assert(prepared.badge === '3', 'the More stop counts them', prepared);
    assert(prepared.moreLabel?.includes('3 hidden charts') === true, 'and names the count for a screen reader', prepared);
    assert(prepared.list.length === 3, 'the list names all three', prepared);

    await page.locator('.vela-mb-more').tap();
    await page.waitForSelector('.vela-md-row', { timeout: 5000 });
    // The row is ONE tap inside More (the badge's counterpart), not buried in a pane.
    const row = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.vela-md-row')];
        const el = rows.find((r) => r.querySelector('.vela-md-row-label')?.textContent === 'Hidden charts');
        return el ? { value: el.querySelector('.vela-md-row-value')?.textContent, chev: !!el.querySelector('.vela-icon') } : null;
    });
    assert(row && row.value === '3', 'More carries a Hidden charts row with the count', row);

    await page.evaluate(() => {
        const el = [...document.querySelectorAll('.vela-md-row')].find((r) => r.querySelector('.vela-md-row-label')?.textContent === 'Hidden charts');
        el.click();
    });
    await page.waitForTimeout(400);
    const listed = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('.vela-md-hlist .vela-md-row')].map((r) => ({
            label: r.querySelector('.vela-md-row-label')?.textContent,
            value: r.querySelector('.vela-md-row-value')?.textContent,
        })),
        hint: document.querySelector('.vela-md-hhint')?.textContent?.slice(0, 40),
    }));
    assert(listed.rows.length === 3, 'the sheet lists the three parked charts', listed);
    assert(listed.rows.every((r) => r.label && r.value), 'each row carries a ticker and an interval', listed);

    const picked = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const ws = window.__ws;
        const row = document.querySelector('.vela-md-hlist .vela-md-row');
        const symbol = row.querySelector('.vela-md-row-label').textContent;
        row.click();
        await wait(1200);
        const badge = document.querySelector('.vela-mb-more .vela-mb-badge');
        return {
            symbol,
            active: ws.active.symbol,
            cells: ws.cells().length,
            hidden: ws.hiddenChartCount,
            list: ws.hiddenChartList().map((h) => h.symbol),
            badge: badge && !badge.hidden ? badge.textContent : null,
            sheetOpen: !!document.querySelector('.vela-md-hlist')?.offsetParent,
        };
    });
    assert(picked.active?.includes(picked.symbol), 'the tapped chart is on the grid', picked);
    assert(picked.cells === 1, '…and the grid kept its shape', picked);
    assert(picked.hidden === 3, 'the swap leaves the count alone — one in, one out', picked);
    assert(picked.list.includes(picked.symbol) === false, 'the chart that came back left the list', picked);
    assert(picked.sheetOpen === false, 'the sheet closes on the way to the chart', picked);

    await context.close();
    report('sync-mobile-anatomy', { widths: facts, prepared, row, listed, picked });
} catch (err) {
    console.error(err);
    errors.push(String(err));
} finally {
    await browser.close();
    if (errors.length) {
        console.error(`\n${errors.length} error(s):\n${errors.join('\n')}`);
        process.exit(1);
    }
}
