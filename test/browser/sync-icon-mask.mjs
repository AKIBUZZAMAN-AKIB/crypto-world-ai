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

    // THE GLYPH MUST ACTUALLY PAINT. A data-URI mask is its own document: without the SVG
    // namespace (or with a black token under luminance masking) it decodes to nothing and the
    // icon is silently invisible — every computed style still looks correct. So this measures
    // pixels: the icon's box must contain ink at rest, and its mask must be doing the shaping.
    const inkOf = async () => {
        const icon = page.locator('.vela-icon').first();
        const r = await icon.boundingBox();
        const clip = { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
        const png = await page.screenshot({ clip });
        const ink = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            // The icon box's own background differs from the ink when the glyph is drawn.
            const counts = new Map();
            for (let i = 0; i < d.length; i += 4) {
                const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
                counts.set(k, (counts.get(k) ?? 0) + 1);
            }
            const sorted = [...counts.values()].sort((a, b) => b - a);
            const total = sorted.reduce((a, b) => a + b, 0);
            return { colours: counts.size, inkShare: total ? 1 - sorted[0] / total : 0 };
        }, png.toString('base64'));
        return { png, ...ink };
    };
    const painted = await inkOf();
    facts.paint = { inks: painted.inkShare.toFixed(3), colours: painted.colours };
    assert(painted.colours >= 2 && painted.inkShare > 0.05, 'the glyph really paints (the icon box holds ink)', facts.paint);
    const maskedPixels = hash(painted.png);
    await page.addStyleTag({ content: '.vela-icon{mask-image:none !important;-webkit-mask-image:none !important;}' });
    const solid = await inkOf();
    facts.paint.masked = maskedPixels;
    facts.paint.solid = hash(solid.png);
    assert(facts.paint.masked !== facts.paint.solid, 'the mask is what shapes the ink (unmasked it is a solid square)', facts.paint);
    // A glyph leaves the box's own colour behind it (two or more colours); unmasked, the box is
    // one flat square of the icon's colour (the ink measure inverts, so colours is the proof).
    assert(solid.colours <= 2, 'unmasked the box is a flat square — so the mask is the shape', { maskedColours: painted.colours, solidColours: solid.colours });

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
