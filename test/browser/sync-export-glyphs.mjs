// R80 — the PNG export must show GLYPHS, not blocks. An icon is a `background-color` cut by
// a CSS mask; the export's DOM rasterizer only knew backgrounds, so every masked icon in a
// screenshot (the status line's market bubble, legend-row controls, the replay line) came out
// as a solid square — and an icon whose mask never got built was solid on SCREEN too.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open({ viewport: { width: 1280, height: 800 } });
const facts = {};

try {
    // ── 1. every icon on screen is a real mask ───────────────────────────────────
    const icons = await page.evaluate(() =>
        [...document.querySelectorAll('.vela-icon')].map((el) => {
            const cs = getComputedStyle(el);
            const mask = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage ?? 'none';
            const svg = mask.startsWith('url(') ? decodeURIComponent(mask.slice(mask.indexOf(',') + 1, -2)) : '';
            const box = el.getBoundingClientRect();
            return {
                shared: /vela-ic-/.test(el.className),
                size: [Math.round(box.width), Math.round(box.height)],
                namespaced: svg.includes('xmlns'),
                shapes: /<(path|circle|rect|line|polyline|polygon|ellipse)/.test(svg),
                paint: cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
            };
        }),
    );
    const broken = icons.filter((i) => !i.namespaced || !i.shapes || !i.paint);
    facts.icons = { n: icons.length, shared: icons.filter((i) => i.shared).length, broken: broken.length };
    assert(icons.length > 10, 'the shell is built with its icons', facts.icons);
    assert(broken.length === 0, 'every icon carries a namespaced SVG mask with real shapes AND a paint', { broken: broken.slice(0, 3) });
    assert(facts.icons.shared > 0, 'icons of a registry id share one stylesheet rule', facts.icons);

    // ── 2. a masked icon, exported through the real path ─────────────────────────
    // A legend row's controls are text entities (no glyphs), so the deterministic second
    // subject is a masked icon mounted where the export looks: `data-vela-screenshot` on the
    // mount container's subtree. Without the mask the export must be a flat square; with it,
    // the same box holds the glyph's ink — that difference IS the rasterizer's contract.
    const inkFor = (masked) =>
        page.evaluate(async (withMask) => {
            const cell = window.__ws.cells()[0];
            const host = document.querySelector('.vela-cell');
            let probe = document.getElementById('__export_probe');
            if (!probe) {
                probe = document.createElement('div');
                probe.id = '__export_probe';
                probe.setAttribute('data-vela-screenshot', '1');
                probe.style.cssText = 'position:absolute;left:40px;top:120px;width:24px;height:24px;z-index:99;';
                const glyph = document.createElement('span');
                glyph.id = '__export_glyph';
                glyph.className = 'vela-icon vela-ic-market-open';
                glyph.style.cssText = 'width:24px;height:24px;background-color:rgb(255,255,255);';
                probe.appendChild(glyph);
                host.appendChild(probe);
            }
            const glyph = document.getElementById('__export_glyph');
            glyph.style.maskImage = withMask ? '' : 'none';
            // the shared rule carries the mask; `none` above beats it only if it wins the
            // cascade, so set the inline value explicitly both ways.
            if (withMask) glyph.style.removeProperty('mask-image');
            else glyph.style.setProperty('mask-image', 'none', 'important');
            const url = cell.chart.renderer.screenshot();
            const img = new Image();
            img.src = url;
            await img.decode();
            const plot = document.querySelector('.vela-cell canvas').parentElement.getBoundingClientRect();
            const dpr = img.width / plot.width;
            const r = glyph.getBoundingClientRect();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const x = Math.round((r.left - plot.left) * dpr);
            const y = Math.round((r.top - plot.top) * dpr);
            const w = Math.max(1, Math.round(r.width * dpr));
            const h = Math.max(1, Math.round(r.height * dpr));
            const d = ctx.getImageData(x, y, w, h).data;
            const counts = new Map();
            for (let i = 0; i < d.length; i += 4) {
                const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
                counts.set(k, (counts.get(k) ?? 0) + 1);
            }
            const top = Math.max(...counts.values());
            return { colours: counts.size, inkShare: Number((1 - top / (w * h)).toFixed(3)) };
        }, masked);

    const withMask = await inkFor(true);
    const withoutMask = await inkFor(false);
    facts.probe = { withMask, withoutMask };
    assert(withMask.inkShare > 0.05 && withMask.colours > 2, 'a masked icon exports as glyph ink', withMask);
    assert(withoutMask.inkShare < 0.02 && withoutMask.colours === 1, '…and an unmasked box exports as the flat square (the control)', withoutMask);
    await page.evaluate(() => document.getElementById('__export_probe')?.remove());

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-export-glyphs', facts);
} finally {
    await browser.close();
}
