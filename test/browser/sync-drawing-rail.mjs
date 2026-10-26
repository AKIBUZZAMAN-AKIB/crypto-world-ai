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
    const fly = await page.evaluate(() => {
        const el = document.querySelector('.vela-dtb-flyout');
        const badge = el?.querySelector('.vela-dtb-badge .vela-icon');
        const star = el?.querySelector('.vela-dtb-star .vela-icon');
        const masked = (e) => !!e && (getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage || 'none') !== 'none';
        return {
            open: !!el,
            rows: document.querySelectorAll('.vela-dtb-flyout .vela-dtb-item').length,
            shapes: el ? el.querySelectorAll('svg, path, rect, circle, line, polygon').length : -1,
            badge: masked(badge),
            star: masked(star),
        };
    });
    facts.flyout = fly;
    assert(fly.open && fly.rows > 1, 'clicking the drawn caret opens the flyout', fly);
    // …and every glyph inside it is painted, not built (badges, the selected check, the stars).
    assert(fly.shapes === 0, 'the flyout holds no SVG shapes at all', fly);
    assert(fly.badge, 'a row badge paints its glyph', fly);

    // 3. The icon: one masked element inside the hit square, sized 18px, owning no shapes.
    const icon = await page.evaluate(() => {
        const b = document.querySelector('.vela-dtb-icon');
        const glyph = b.querySelector('.vela-dtb-hit > .vela-icon');
        const cs = glyph ? getComputedStyle(glyph) : null;
        return {
            glyph: !!glyph,
            kids: glyph ? glyph.getElementsByTagName('*').length : -1,
            svg: !!b.querySelector('svg'),
            masked: cs ? (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none' : false,
            box: glyph ? [Math.round(glyph.getBoundingClientRect().width), Math.round(glyph.getBoundingClientRect().height)] : null,
        };
    });
    facts.icon = icon;
    assert(icon.glyph && !icon.svg, 'the glyph is a masked element — no inline <svg> in the cell', icon);
    assert(icon.kids === 0 && icon.masked, 'the glyph owns no shapes and carries its mask', icon);
    assert(icon.box[0] === 18 && icon.box[1] === 18, 'the glyph is 18px', icon);
    await page.locator('.vela-dtb-icon').first().hover();
    await page.waitForTimeout(200);
    const tint = await page.evaluate(() => getComputedStyle(document.querySelector('.vela-dtb-icon .vela-dtb-hit')).backgroundColor);
    assert(tint !== 'rgba(0, 0, 0, 0)', 'hovering the icon still tints its hit square', { tint });

    // 4. Cost: a cell is its two buttons, one hit square and the glyph's own paths — the
    //    three wrapper/pill spans the caret and the icon used to carry are gone.
    const cost = await page.evaluate(() => {
        const row = document.querySelector('.vela-dtb-cell');
        const all = [...row.getElementsByTagName('*')];
        const spans = all.filter((e) => e.tagName === 'SPAN');
        return {
            buttons: row.querySelectorAll('button').length,
            hits: row.querySelectorAll('.vela-dtb-hit').length,
            spans: spans.map((e) => e.className),
            // Everything in the row is a button, a hit square, a masked glyph or the
            // glyph's own (mesh-free) nothing — no shapes, no wrappers.
            shapes: all.filter((e) => /^(svg|path|circle|rect|line|polyline|polygon|g)$/.test(e.tagName)).length,
            stray: all.filter((e) => e.tagName !== 'BUTTON' && !e.classList.contains('vela-dtb-hit') && !e.classList.contains('vela-icon')).length,
            cells: document.querySelectorAll('.vela-dtb-cell').length,
        };
    });
    facts.cost = cost;
    assert(cost.buttons === 2 && cost.hits === 1, "a cell is its two buttons and the icon's one hit square", cost);
    assert(cost.shapes === 0, 'a cell holds no SVG shapes at all', cost);
    assert(cost.stray === 0, 'nothing sits in a cell but buttons, the hit square and the glyph', cost);

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-drawing-rail', facts);
} finally {
    await browser.close();
}
