// R75 — an icon is a COLOUR, not a drawing (src/ui/icons.ts). Every `.vela-icon` used to wrap
// an inline <svg> with one to four shapes, so a 14px chevron cost the document three or four
// nodes and the top bar paid 60 of them for nineteen glyphs. The glyph is now a CSS mask: one
// element, one shared rule per icon id, painted by `background-color: currentColor`. This
// probe proves the paint is real (a masked glyph is not a solid square), that it follows the
// text colour, and that an unknown id still renders nothing at all.
import { createHash } from 'node:crypto';
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
const facts = {};
const hash = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12);
try {
    const census = await page.evaluate(() => {
        const icons = [...document.querySelectorAll('.vela-icon')];
        const withShapes = icons.filter((e) => e.childElementCount > 0);
        const sheet = document.getElementById('vela-icon-styles');
        return {
            icons: icons.length,
            withShapes: withShapes.map((e) => e.parentElement?.className ?? '?'),
            masked: icons.filter((e) => (getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage || 'none') !== 'none').length,
            sheets: document.querySelectorAll('#vela-icon-styles').length,
            rules: (sheet?.textContent ?? '').split('.vela-ic-').length - 1,
            box: (() => {
                const e = icons[0];
                const r = e.getBoundingClientRect();
                return [Math.round(r.width), Math.round(r.height)];
            })(),
        };
    });
    facts.census = census;
    assert(census.icons > 10, 'the shell is built with its icons', census);
    assert(census.withShapes.length <= 1, 'an icon element owns no shapes (only the live layout glyph does)', census);
    assert(census.masked === census.icons, 'every icon carries a mask image', census);
    // One rule per icon ID actually handed to `iconEl` (icons built then destroyed keep theirs;
    // the id, not the instance, owns the rule).
    // Rules are per ID, instances are per element: several glyphs share one rule (and the
    // layout widget's live glyph is not masked at all), so rules ≤ icons.
    assert(census.sheets === 1 && census.rules > 0 && census.rules <= census.icons, 'one shared sheet, one rule per masked icon id', census);

    // The paint is a glyph, not a filled square: strip the mask and the pixels change.
    const icon = page.locator('.vela-icon').first();
    const r = await icon.boundingBox();
    const clip = { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    const masked = await page.screenshot({ clip });
    await page.addStyleTag({ content: '.vela-icon{mask-image:none !important;-webkit-mask-image:none !important;}' });
    const solid = await page.screenshot({ clip });
    facts.paint = { masked: hash(masked), solid: hash(solid) };
    assert(facts.paint.masked !== facts.paint.solid, 'the masked glyph paints a shape (unmasked it is a solid square)', facts.paint);

    // …and the shape is painted in the text colour: recolour the trigger, the glyph follows.
    const colour = await page.evaluate(() => {
        const el = document.querySelector('.vela-icon');
        const before = getComputedStyle(el).backgroundColor;
        el.style.color = 'rgb(255, 0, 0)';
        const after = getComputedStyle(el).backgroundColor;
        const box = el.getBoundingClientRect();
        return { before, after, box: [Math.round(box.width), Math.round(box.height)] };
    });
    facts.colour = colour;
    assert(colour.after === 'rgb(255, 0, 0)', 'the glyph takes its colour from `color` (background-color: currentColor)', colour);

    // An unknown id is still an empty, invisible span — never a broken box.
    const unknown = await page.evaluate(() => window.__ws?.cells && (() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const span = document.createElement('span');
        span.className = 'vela-icon';
        host.appendChild(span);
        const cs = getComputedStyle(span);
        return { mask: cs.maskImage, kids: span.childElementCount };
    })());
    facts.unknown = unknown;
    assert(unknown.mask === 'none' && unknown.kids === 0, 'an icon element with no icon id paints nothing', unknown);

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-icon-mask', facts);
} finally {
    await browser.close();
}
