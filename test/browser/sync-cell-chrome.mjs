// R79 — a chart cell carries only what it is SHOWING. Four containers used to sit in every
// cell from construction, invisible: the cell's own drawing rail (a workspace shares ONE
// rail), its attribution mark (the grid mounts one for the whole workspace), the timeline
// marks' positioning anchor, and the shade-right veil element — plus the cell-controls
// cluster, mounted but hidden until the cursor came near. Each is now built by the state
// that shows it, and this probe drives every one of those states for real.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
const facts = {};
const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);

try {
    // ── 1. at rest: none of them exist ────────────────────────────────────────────
    const rest = await page.evaluate(() => {
        const cell = document.querySelector('.vela-cell');
        return {
            cells: document.querySelectorAll('.vela-cell').length,
            railMounts: document.querySelectorAll('.vela-cell .vela-dtb').length,
            attribution: document.querySelectorAll('.vela-attribution').length,
            marks: document.querySelectorAll('.vela-marks-anchor').length,
            shade: document.querySelectorAll('.vela-shade-right').length,
            rails: document.querySelectorAll('.vela-dtb').length,
            perCell: [...document.querySelectorAll('.vela-cell')].map((c) => c.children.length),
        };
    });
    facts.rest = rest;
    assert(rest.cells >= 4, 'the grid is built', rest);
    assert(rest.railMounts === 0, "a cell keeps no drawing-rail mount (the workspace shares one rail)", rest);
    assert(rest.rails === 1, 'exactly one drawing rail is in the document', rest);
    // ONE mark for the whole workspace (re-parented into the active cell) — not one per cell.
    assert(rest.attribution === 1, 'the document holds exactly one attribution mark (the grid\'s)', rest);
    assert(rest.marks === 0, 'no timeline-marks anchor sits in an untouched chart', rest);
    assert(rest.shade === 0, 'no shade-right veil sits in a chart that never veiled', rest);
    assert(Math.max(...rest.perCell) <= 4, 'a cell holds only its chart root, watermark, status line (+ the grid mark)', rest);

    // ── 2. the cell-controls cluster arrives with its first reveal ────────────────
    const cell = page.locator('.vela-cell').first();
    const box = await cell.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
    await page.waitForTimeout(350);
    const cluster = await page.evaluate(() => {
        const c = document.querySelector('.vela-cell');
        const el = [...c.children].find((n) => n.style && n.style.zIndex === '6');
        return el
            ? { display: el.style.display, buttons: [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) }
            : null;
    });
    facts.cluster = cluster;
    assert(cluster !== null && cluster.display === 'flex', 'the cluster is mounted by its first reveal', cluster);
    assert(cluster.buttons.length >= 4 && cluster.buttons.includes('Zoom in'), '…with its full button set', cluster);
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.waitForTimeout(250);
    const hiddenCluster = await page.evaluate(() => {
        const c = document.querySelector('.vela-cell');
        const el = [...c.children].find((n) => n.style && n.style.zIndex === '6');
        return el ? el.style.display : 'gone';
    });
    facts.clusterHidden = hiddenCluster;
    assert(hiddenCluster === 'none', 'and it hides again when the cursor leaves', { hiddenCluster });

    // ── 3. the shade-right veil is built by the frame that paints it ──────────────
    await page.evaluate(() => window.__ws.cells()[0].chart.renderer.set('crosshairOverride', { shadeRight: { color: 'rgba(255,255,255,0.22)' } }));
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
    await page.waitForTimeout(400);
    const veil = await page.evaluate(() => {
        const el = document.querySelector('.vela-shade-right');
        if (!el) return null;
        const canvas = [...document.querySelectorAll('.vela-cell canvas')];
        return {
            width: Number.parseFloat(el.style.width),
            height: Number.parseFloat(el.style.height),
            hidden: el.hidden,
            beforeCursorCanvas: canvas.some((c) => (el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
        };
    });
    facts.veil = veil;
    assert(veil !== null, 'the veil element is built when a veil is painted', veil);
    assert(veil.width > 0 && veil.height > 0 && !veil.hidden, '…at the veiled rectangle', veil);
    assert(veil.beforeCursorCanvas, '…in its documented slot: under the cursor canvas', veil);
    await page.evaluate(() => window.__ws.cells()[0].chart.renderer.set('crosshairOverride', null));
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await page.waitForTimeout(300);
    const veilOff = await page.evaluate(() => {
        const el = document.querySelector('.vela-shade-right');
        return el ? { hidden: el.hidden, display: el.style.display } : 'never-built';
    });
    facts.veilOff = veilOff;
    assert(veilOff === 'never-built' || (veilOff.hidden && veilOff.display === 'none'), 'clearing the override hides the veil again', veilOff);

    // ── 4. an attribution mark appears the moment a cell asks for one ─────────────
    await page.evaluate(() => window.__ws.cells()[0].chart.renderer.set('attribution', true));
    await page.waitForTimeout(200);
    const attrOn = await count('.vela-attribution');
    facts.attribution = { on: attrOn };
    assert(attrOn === 2, 'turning attribution on builds that cell\'s own mark', { attrOn });
    await page.evaluate(() => window.__ws.cells()[0].chart.renderer.set('attribution', false));
    await page.waitForTimeout(200);
    const attrOff = await count('.vela-attribution');
    facts.attribution.off = attrOff;
    assert(attrOff === 1, 'turning it off takes that mark out of the document', { attrOff });

    assert(errors.length === 0, 'no page errors', { errors });
    report('sync-cell-chrome', facts);
} finally {
    await browser.close();
}
