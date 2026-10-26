// R74 — the drawing rail's caret is DRAWN, not built. Every cell used to carry a
// five-node chevron (button ← hit span ← wrapper span ← svg ← path) and a three-node icon
// (button ← hit span ← wrapper span ← svg), nine times over: 45 nodes for two 11/18px
// glyphs that a border and an attribute say just as well. The visible behaviour is the
// contract here — the caret still appears on hover, still opens the flyout, and the icon
// still carries its tint — so this probe drives the real pointer, not the markup.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
const facts = {};
try {
    const rail = page.locator('.vela-dtb').first();
    const cells = await page.locator('.vela-dtb-cell').count();
    assert(cells >= 8, 'the rail is built with its cells', { cells });

    // 1. The caret is a button and nothing more: its pill and chevron are pseudo-elements.
    const shape = await page.evaluate(() => {
        const a = document.querySelector('.vela-dtb-arrow');
        const after = getComputedStyle(a, '::after');
        const r = a.getBoundingClientRect();
        return {
            kids: a.children.length,
            text: (a.textContent ?? '').trim(),
            tag: a.tagName,
            label: a.getAttribute('aria-label'),
            w: Math.round(r.width),
            h: Math.round(r.height),
            caret: after.content !== 'none' && parseFloat(after.width) > 0,
            border: after.borderTopWidth,
        };
    });
    facts.caret = shape;
    assert(shape.kids === 0 && shape.text === '', 'the caret carries no element children at all', shape);
    assert(shape.tag === 'BUTTON' && /more$/.test(shape.label ?? ''), 'it is still a named button ("… — more")', shape);
    assert(shape.w === 11 && shape.h === 22, 'it keeps its 11×22 hover target', shape);
    assert(shape.caret, 'the chevron is drawn by the stylesheet (::after content + size)', shape);

    // 2. Reveal + flyout on a REAL pointer: hover the cell, click the caret.
    const cell = page.locator('.vela-dtb-cell').nth(2);
    const restOpacity = await page.evaluate(() => getComputedStyle(document.querySelector('.vela-dtb-cell .vela-dtb-arrow')).opacity);
    assert(restOpacity === '0', 'an unhovered cell hides its caret', { restOpacity });
    await cell.hover();
    await page.waitForTimeout(200);
    const hovered = await page.evaluate(() => {
        const a = document.querySelectorAll('.vela-dtb-cell')[2].querySelector('.vela-dtb-arrow');
        const cs = getComputedStyle(a);
        const r = a.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { opacity: cs.opacity, pe: cs.pointerEvents, hitsArrow: hit === a || a.contains(hit) };
    });
    facts.hover = hovered;
    assert(hovered.opacity === '1', 'hovering the cell reveals the caret', hovered);
    assert(hovered.pe === 'auto' && hovered.hitsArrow, 'the visible caret is the thing the pointer lands on', hovered);

    await cell.locator('.vela-dtb-arrow').click();
    await page.waitForTimeout(350);
    const fly = await page.evaluate(() => ({
        open: !!document.querySelector('.vela-dtb-flyout'),
        rows: document.querySelectorAll('.vela-dtb-flyout .vela-dtb-item').length,
    }));
    facts.flyout = fly;
    assert(fly.open && fly.rows > 1, 'clicking the drawn caret opens the flyout', fly);

    // 3. The icon: glyph sized inline (no wrapper span), hit square still tints on hover.
    const icon = await page.evaluate(() => {
        const b = document.querySelector('.vela-dtb-icon');
        const svg = b.querySelector('.vela-dtb-hit > svg');
        const wrap = b.querySelector('.vela-dtb-hit > span');
        return { direct: !!svg, wrapper: wrap ? wrap.tagName : null, w: svg?.getAttribute('width'), h: svg?.getAttribute('height') };
    });
    facts.icon = icon;
    assert(icon.direct && icon.wrapper === null, 'the glyph is a direct child of its hit square (no wrapper span)', icon);
    assert(icon.w === '18' && icon.h === '18', 'the glyph carries its own 18px size', icon);
    await page.locator('.vela-dtb-icon').first().hover();
    await page.waitForTimeout(200);
    const tint = await page.evaluate(() => getComputedStyle(document.querySelector('.vela-dtb-icon .vela-dtb-hit')).backgroundColor);
    assert(tint !== 'rgba(0, 0, 0, 0)', 'hovering the icon still tints its hit square', { tint });

    // 4. Cost: a cell is its two buttons, one hit square and the glyph's own paths — the
    //    three wrapper/pill spans the caret and the icon used to carry are gone.
    const cost = await page.evaluate(() => {
        const row = document.querySelector('.vela-dtb-cell');
        const glyph = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g']);
        const all = [...row.getElementsByTagName('*')];
        return {
            buttons: row.querySelectorAll('button').length,
            hits: row.querySelectorAll('.vela-dtb-hit').length,
            inlineSpans: all.filter((e) => e.tagName === 'SPAN' && e.hasAttribute('style')).length,
            chrome: all.filter((e) => !glyph.has(e.tagName) && e.tagName !== 'BUTTON' && !e.classList.contains('vela-dtb-hit')).length,
            cells: document.querySelectorAll('.vela-dtb-cell').length,
        };
    });
    facts.cost = cost;
    assert(cost.buttons === 2 && cost.hits === 1, 'a cell is its two buttons and the icon\'s one hit square', cost);
    assert(cost.inlineSpans === 0, 'no inline-styled wrapper spans are left in a cell', cost);
    assert(cost.chrome === 0, 'nothing sits in a cell but buttons, hit squares and glyph geometry', cost);

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-drawing-rail', facts);
} finally {
    await browser.close();
}
