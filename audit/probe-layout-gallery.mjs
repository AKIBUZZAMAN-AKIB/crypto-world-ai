// Round-22 probe: the layout gallery. Opens the layout sheet, counts the preset tiles,
// reports every preset id the workspace exposes, and screenshots the sheet.
import { open, report } from '../test/browser/helpers.mjs';

const { browser, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
try {
    await page.evaluate(() => window.__ws.setLayout('4'));
    await page.waitForTimeout(700);
    await page.click('button[aria-label^="Layout —"]');
    await page.waitForTimeout(700);
    const facts = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('.vela-lp-preset')];
        const caps = [...document.querySelectorAll('.vela-lp-presetcount')].map((c) => c.textContent?.trim());
        return {
            tiles: tiles.length,
            captions: caps,
            ids: [...document.querySelectorAll('.vela-lp-preset')].map((b) => b.title),
            sheet: (() => {
                const p = document.querySelector('.vela-lp');
                if (!p) return null;
                const r = p.getBoundingClientRect();
                return { w: Math.round(r.width), h: Math.round(r.height) };
            })(),
        };
    });
    await page.screenshot({ path: 'audit/r22-layout-gallery.png' });
    report('round22-layout-gallery', { ...facts, errors: errors.length });
} finally {
    await browser.close();
}
