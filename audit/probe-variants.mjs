// Round-22 probe: every painting variant, rendered for real.
//
// Sets the single-chart layout, cycles the price style through all eight variants,
// records the style id the renderer accepted plus a pixel signature of the plot (so a
// "variant" that paints nothing is visible as an identical signature), and screenshots
// each one.
import { open, report } from '../test/browser/helpers.mjs';

const STYLES = [
    'candles',
    'hollow-candles',
    'volume-candles',
    'line-markers',
    'stepline',
    'hlc-area',
    'columns',
    'high-low',
    'hlc-bars',
];

/**
 * A cheap fingerprint of the painted plot: ink coverage + a colour histogram.
 *
 * The screenshot is decoded INSIDE the page (an Image + an offscreen canvas) rather than
 * read off a chart canvas: the chart may be WebGL2, where `getImageData` on the visible
 * canvas returns an empty buffer once the frame has been presented. What we want to
 * compare is what the user SEES, which is exactly the screenshot.
 */
const signature = (page) =>
    page.evaluate(async () => {
        const dataUrl = window.__lastShot;
        if (!dataUrl) return null;
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { note: 'no 2d context' };
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(Math.round(img.width * 0.08), Math.round(img.height * 0.1), Math.round(img.width * 0.8), Math.round(img.height * 0.7));
        let ink = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < data.length; i += 16) {
            const R = data[i];
            const G = data[i + 1];
            const B = data[i + 2];
            if (R + G + B > 90) {
                ink += 1;
                r += R;
                g += G;
                b += B;
            }
        }
        const n = Math.max(1, ink);
        return { ink, r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
    });

const { browser, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
const facts = {};
try {
    await page.evaluate(() => window.__ws.setLayout('1'));
    await page.waitForTimeout(900);
    console.log('cell box', JSON.stringify(await page.evaluate(() => { const c = document.querySelector('#workspace'); const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), canvases: document.querySelectorAll('canvas').length }; })));
    for (const style of STYLES) {
        await page.evaluate((s) => window.__ws.cells()[0].setPriceStyle(s), style);
        await page.waitForTimeout(650);
        const accepted = await page.evaluate(() => window.__ws.cells()[0].priceStyle);
        const shot = await page.screenshot({ path: `/tmp/vela-probes/r22-style-${style}.png` });
        await page.evaluate((b64) => { window.__lastShot = 'data:image/png;base64,' + b64; }, shot.toString('base64'));
        const sig = await signature(page);
        facts[style] = { accepted, ...sig };
    }
} finally {
    await browser.close();
}
// The style MENU is the door the user actually walks through: list it and check each
// variant row carries its glyph.
const menu = await (async () => {
    const { browser, page, errors: e2 } = await open({ viewport: { width: 1440, height: 900 } });
    try {
        await page.click('button[aria-label^="Chart type"], button[aria-label*="Candles"]');
        await page.waitForTimeout(400);
        const rows = await page.evaluate(() =>
            [...document.querySelectorAll('.vela-menu [role="menuitem"], .vela-popover [role="menuitem"], [data-style-menu] [role="menuitem"]')].map((r) => ({
                label: r.textContent?.trim(),
                icon: Boolean(r.querySelector('svg')),
            })),
        );
        return { rows: rows.length ? rows : null, errors: e2.length };
    } finally {
        await browser.close();
    }
})();

report('round22-variants', { ...facts, menu, errors });
