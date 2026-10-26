// R81 — the PNG export's BLIND SPOTS are a contract, not a surprise.
//
// The DOM rasterizer is hand-written (the export port is synchronous, so there is no HTML
// renderer to call): it draws backgrounds, borders, box-shadow, text, loaded images, inline
// SVG and masked icons. Anything else — a gradient, a filter, a transform, a clip-path, a
// mask on a non-icon, text that wraps — silently vanishes from a saved chart. None of those
// appear in the chart's chrome TODAY (measured: 0 at rest, 0 with a legend row hovered), so
// there is nothing to approximate; this probe keeps it that way. When a surface grows one,
// this fails and names the element instead of shipping a screenshot with a hole in it.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open({ viewport: { width: 1280, height: 800 } });
const facts = {};

const scan = () =>
    page.evaluate(() => {
        const roots = [...document.querySelectorAll('[data-vela-screenshot], [data-vela-pane]')];
        const offenders = [];
        const wrappedText = [];
        const note = (el, why) => offenders.push({ cls: el.className.toString().slice(0, 46), why });
        for (const root of roots) {
            for (const el of root.querySelectorAll('*')) {
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (cs.backgroundImage && cs.backgroundImage !== 'none') note(el, 'background-image');
                if (cs.filter && cs.filter !== 'none') note(el, 'filter');
                if (cs.backdropFilter && cs.backdropFilter !== 'none') note(el, 'backdrop-filter');
                if (cs.clipPath && cs.clipPath !== 'none') note(el, 'clip-path');
                if (cs.textShadow && cs.textShadow !== 'none') note(el, 'text-shadow');
                if (cs.maskImage && cs.maskImage !== 'none' && !el.classList.contains('vela-icon')) note(el, 'mask-image (not an icon)');
                // A transform on an SVG child is skipped by the rasterizer on purpose.
                if (el instanceof SVGElement && el.hasAttribute('transform')) note(el, 'svg transform');
            }
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if ((node.textContent ?? '').trim().length < 2) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const lines = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1).length;
                if (lines > 1) wrappedText.push({ text: (node.textContent ?? '').trim().slice(0, 30), lines });
            }
        }
        return { roots: roots.length, offenders: offenders.slice(0, 10), offenderCount: offenders.length, wrappedText: wrappedText.slice(0, 6) };
    });

try {
    const atRest = await scan();
    facts.atRest = atRest;
    assert(atRest.roots > 0, 'the chart has an overlay to export', atRest);
    assert(atRest.offenderCount === 0, 'nothing in the export uses paint the rasterizer cannot draw', atRest.offenders);
    assert(atRest.wrappedText.length === 0, 'no exported text is laid out on more than one line', atRest.wrappedText);

    // The same contract must hold for the transient chrome: a legend row's control cluster
    // (an inset ring) is what a user exports the moment they finish tweaking an indicator.
    const title = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[data-vela-pane="price"] *')].find((e) => e.textContent?.trim() === 'Volume');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    assert(title !== null, 'the legend has a row to reveal', title);
    if (title) {
        await page.mouse.move(title.x, title.y, { steps: 4 });
        await page.waitForTimeout(260);
        const hovered = await scan();
        facts.hovered = hovered;
        assert(hovered.offenderCount === 0, '…and stays true with the control cluster out', hovered.offenders);
        // The cluster is the one element in the chart that wears a shadow, and its ring is
        // 1 CSS px — so measure the EXPORT, not the CSS: the row one pixel inside the
        // cluster's top edge must carry the ring's colour, not the fill behind it.
        const ring = await page.evaluate(async () => {
            const chip = [...document.querySelectorAll('.vela-cell *')].find((el) => {
                const cs = getComputedStyle(el);
                return cs.boxShadow && cs.boxShadow !== 'none' && /inset/.test(cs.boxShadow);
            });
            if (!chip) return null;
            const cs = getComputedStyle(chip);
            const cell = window.__ws.cells()[0];
            const url = cell.chart.renderer.screenshot();
            const img = new Image();
            img.src = url;
            await img.decode();
            const plot = document.querySelector('.vela-cell canvas').parentElement.getBoundingClientRect();
            const dpr = img.width / plot.width;
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const r = chip.getBoundingClientRect();
            const x = Math.round((r.left - plot.left) * dpr) + Math.round(r.width * dpr * 0.25);
            const yTop = Math.round((r.top - plot.top) * dpr);
            const yIn = yTop + Math.round(7 * dpr);
            const at = (px, py) => [...ctx.getImageData(px, py, 1, 1).data].slice(0, 3);
            const fill = at(x, yIn);
            const band = [];
            for (let dy = -1; dy <= 2; dy++) band.push(at(x, yTop + dy));
            const dist = (c) => Math.abs(c[0] - fill[0]) + Math.abs(c[1] - fill[1]) + Math.abs(c[2] - fill[2]);
            return { shadow: cs.boxShadow, dpr, fill, band, strongest: Math.max(...band.map(dist)), size: [Math.round(r.width), Math.round(r.height)] };
        });
        facts.clusterRing = ring;
        assert(ring !== null, 'the hovered row has an element wearing a shadow', ring);
        if (ring) {
            facts.ringDistance = ring.strongest;
            // A 1 CSS px ring under a fractional cell offset: take the strongest of the
            // four pixel rows straddling the top edge, and compare it to the fill below.
            assert(ring.strongest > 12, 'the exported PNG carries the inset ring (edge ≠ fill)', ring);
        }
    }

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-export-paint', facts);
} finally {
    await browser.close();
}
