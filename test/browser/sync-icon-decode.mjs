// R82 — an icon is a MASK, and a mask must DECODE.
//
// The registry writes icons the way HTML likes them (`fill="currentColor"` before the tier
// default, so the first wins). A mask, though, loads as an XML document, where a repeated
// attribute is a fatal error: the image does not decode and the glyph is not there. Six
// registry icons were written that way — kebab (the phone's More button), cursor (the
// drawing rail), bold, italic, grip, star-filled — and every button wearing one was blank.
// This probe proves the whole shell the way a user meets it: decode each icon's mask, paint
// it, and require ink.
import { open, assert, report } from './helpers.mjs';

const files = { viewport: { width: 1440, height: 900 } };

/** Decode every icon on screen; return the ones that paint nothing. */
const sweep = (page) =>
    page.evaluate(async () => {
        const els = [...document.querySelectorAll('.vela-icon')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 4 && r.height > 4;
        });
        const broken = [];
        const seen = new Map();
        for (const el of els) {
            const cs = getComputedStyle(el);
            const raw = cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage;
            if (!raw || raw === 'none') {
                broken.push({ cls: el.className.toString().slice(0, 44), why: 'no mask' });
                continue;
            }
            const m = /url\("?(data:image\/svg\+xml,[^")]+)"?\)/.exec(raw);
            if (!m) {
                broken.push({ cls: el.className.toString().slice(0, 44), why: 'mask is not an svg data uri' });
                continue;
            }
            if (seen.has(m[1])) continue;
            const img = new Image();
            img.src = m[1];
            try {
                await img.decode();
                const c = document.createElement('canvas');
                c.width = 32;
                c.height = 32;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0, 32, 32);
                const d = ctx.getImageData(0, 0, 32, 32).data;
                let ink = 0;
                for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
                seen.set(m[1], ink);
                if (ink < 4) broken.push({ cls: el.className.toString().slice(0, 44), why: `decodes but paints ${ink}px` });
            } catch (e) {
                seen.set(m[1], 0);
                broken.push({ cls: el.className.toString().slice(0, 44), why: `decode failed: ${String(e).slice(0, 44)}` });
            }
        }
        return { icons: els.length, masks: seen.size, broken };
    });

const { browser, page, errors } = await open(files);
const facts = {};

try {
    const first = await sweep(page);
    facts.desktop = first;
    assert(first.icons > 20, 'the shell is wearing its icons', first);
    assert(first.broken.length === 0, 'every icon mask DECODES and paints ink', first.broken);

    // The drawing rail holds the tier-B set (cursor, bold, italic…) — the ones that were
    // blank. It is on screen by default; walk its buttons so their glyphs are mounted.
    const rail = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.vela-dtb-btn, .vela-drawrail-btn, [class*="dtb"] button, [class*="rail"] button')];
        return { n: btns.length, labels: btns.slice(0, 6).map((b) => (b.getAttribute('aria-label') || '').slice(0, 20)) };
    });
    facts.rail = rail;
    assert(rail.n > 5, 'the drawing rail is mounted', rail);

    // A panel with rows of glyphs: the object tree (grip, eye, star…).
    await page.keyboard.press('Control+Alt+O');
    await page.waitForTimeout(400);
    const afterPanel = await sweep(page);
    facts.withPanel = afterPanel;
    assert(afterPanel.broken.length === 0, '…and still every icon decodes with a panel open', afterPanel.broken);

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-icon-decode', facts);
} finally {
    await browser.close();
}
