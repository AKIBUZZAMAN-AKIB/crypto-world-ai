// Object-tree Visual Order. A z-key mutation isn't enough: the tree rows must repaint AND
// the rendered canvas must show the new top-most object. Two opaque overlapping boxes make
// the paint order measurable; candles/indicator rows are checked through their row order.
import { open, assert, report } from './helpers.mjs';

const { page, errors, browser } = await open({ settle: 1800 });

await page.evaluate(() => {
    const chart = window.__ws.active.chart;
    const range = chart.getVisibleRange();
    const price = chart.lastBar.close;
    const anchors = [
        { time: range.from + (range.to - range.from) * 0.35, price: price * 0.985 },
        { time: range.from + (range.to - range.from) * 0.65, price: price * 1.015 },
    ];
    chart.drawings.add('box', {
        anchors,
        style: { lineColor: '#ff0000', lineWidth: 2, lineStyle: 'solid', fillColor: '#ff0000ff' },
    });
    chart.drawings.add('box', {
        anchors,
        style: { lineColor: '#00ff00', lineWidth: 2, lineStyle: 'solid', fillColor: '#00ff00ff' },
    });
});
await page.waitForTimeout(500);

// The object tree is a right-dock panel; on desktop the toolbar button is the stable door.
await page.evaluate(() => {
    if (document.querySelector('.vela-ot-row')) return;
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('Object tree'));
    btn?.click();
});
await page.waitForTimeout(400);

const rows = () =>
    page.evaluate(() =>
        [...document.querySelectorAll('.vela-ot-row')].map((r) => ({
            kind: r.dataset.rowKind,
            id: r.dataset.id ?? '',
            name: r.querySelector('.vela-ot-name')?.textContent ?? '',
        })),
    );

const paint = () =>
    page.evaluate(() => {
        const canvas = window.__ws.active.chart.renderer.screenshotCanvas();
        if (!canvas) return { red: 0, green: 0 };
        const ctx = canvas.getContext('2d');
        if (!ctx) return { red: 0, green: 0 };
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        let green = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0) red += 1;
            if (data[i] === 0 && data[i + 1] === 255 && data[i + 2] === 0) green += 1;
        }
        return { red, green };
    });

async function openRowMenu(target) {
    const point = await page.evaluate((want) => {
        const row = [...document.querySelectorAll('.vela-ot-row')].find((r) => {
            if (want.id !== undefined) return r.dataset.id === want.id;
            if (want.kind !== undefined && r.dataset.rowKind !== want.kind) return false;
            if (want.name !== undefined && !(r.querySelector('.vela-ot-name')?.textContent || '').includes(want.name)) return false;
            return true;
        });
        if (!row) return null;
        const r = row.getBoundingClientRect();
        return { x: r.x + 70, y: r.y + r.height / 2 };
    }, target);
    assert(point !== null, 'the target object-tree row exists', target);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.waitForTimeout(220);
    return page.evaluate(() =>
        [...document.querySelectorAll('.vela-menu-item')]
            .filter((i) => i.offsetParent !== null)
            .map((i) => (i.textContent || '').trim()),
    );
}

async function choose(label) {
    const item = page.locator('.vela-menu-item:visible', { hasText: new RegExp(`^${label}$`) }).first();
    await item.click({ timeout: 5000 });
    await page.waitForTimeout(450);
}

const initialRows = await rows();
const initialPaint = await paint();
assert(initialRows.filter((r) => r.kind === 'drawing').map((r) => r.id).join(',') === 'dw-2,dw-1', 'front-most drawing leads the tree', initialRows);
assert(initialPaint.green > 1000 && initialPaint.red === 0, 'the new green drawing paints above the red one', initialPaint);

const menuItems = await openRowMenu({ id: 'dw-2' });
for (const label of ['Bring to front', 'Bring forward', 'Send backward', 'Send to back']) {
    assert(menuItems.includes(label), `the drawing menu offers ${label}`, menuItems);
}
await choose('Send to back');
const backRows = await rows();
const backPaint = await paint();
assert(backRows.filter((r) => r.kind === 'drawing').map((r) => r.id).join(',') === 'dw-1,dw-2', 'Send to back repaints the tree immediately', backRows);
assert(backPaint.red > 1000 && backPaint.green === 0, 'Send to back changes the real canvas paint order', backPaint);

await openRowMenu({ id: 'dw-2' });
await choose('Bring to front');
const frontRows = await rows();
const frontPaint = await paint();
assert(frontRows.filter((r) => r.kind === 'drawing').map((r) => r.id).join(',') === 'dw-2,dw-1', 'Bring to front repaints the tree immediately', frontRows);
assert(frontPaint.green > 1000 && frontPaint.red === 0, 'Bring to front changes the real canvas paint order', frontPaint);

// Candles and indicators are in the SAME stack. Their old menu path changed renderer state
// without refreshing the tree; assert both ends here.
await page.evaluate(async () => {
    window.__ws.active.chart.addNativeIndicator('sma');
    await new Promise((r) => setTimeout(r, 800));
});
await page.waitForTimeout(400);
await openRowMenu({ kind: 'indicator', name: 'SMA' });
await choose('Bring to front');
const indicatorFront = await rows();
assert(indicatorFront[0]?.kind === 'indicator' && indicatorFront[0]?.name.includes('SMA'), 'indicator Bring to front moves its row to the top', indicatorFront);

await openRowMenu({ kind: 'indicator', name: 'SMA' });
await choose('Send to back');
const indicatorBack = await rows();
assert(indicatorBack.at(-1)?.kind === 'indicator' && indicatorBack.at(-1)?.name.includes('SMA'), 'indicator Send to back moves its row to the bottom', indicatorBack);

await openRowMenu({ kind: 'price' });
await choose('Bring to front');
const priceFront = await rows();
assert(priceFront[0]?.kind === 'price', 'candle Bring to front moves the price row to the top', priceFront);

await openRowMenu({ kind: 'price' });
await choose('Send to back');
const priceBack = await rows();
assert(priceBack.at(-1)?.kind === 'price', 'candle Send to back moves the price row to the bottom', priceBack);

// A group moves as ONE z block. Group the two drawings, then exercise its own menu verbs.
async function rowPoint(id) {
    const point = await page.evaluate((wanted) => {
        const row = document.querySelector(`.vela-ot-row[data-id="${wanted}"]`);
        if (!row) return null;
        const r = row.getBoundingClientRect();
        return { x: r.x + 70, y: r.y + r.height / 2 };
    }, id);
    assert(point !== null, `drawing ${id} is visible for grouping`, id);
    return point;
}
const firstPoint = await rowPoint('dw-1');
await page.mouse.click(firstPoint.x, firstPoint.y);
await page.keyboard.down('Control');
const secondPoint = await rowPoint('dw-2');
await page.mouse.click(secondPoint.x, secondPoint.y);
await page.keyboard.up('Control');
await page.waitForTimeout(250);
await page.evaluate(() => {
    const button = [...document.querySelectorAll('[aria-label="Group selection"]')].find((b) => b.offsetParent !== null);
    button?.click();
});
await page.waitForTimeout(450);
const grouped = await rows();
assert(grouped.some((r) => r.kind === 'group'), 'the two drawings form a group row', grouped);

const groupMenu = await openRowMenu({ kind: 'group' });
for (const label of ['Bring all to front', 'Bring all forward', 'Send all backward', 'Send all to back']) {
    assert(groupMenu.includes(label), `the group menu offers ${label}`, groupMenu);
}
await choose('Bring all to front');
const groupFront = await rows();
assert(groupFront[0]?.kind === 'group', 'the group moves to the front of the object tree', groupFront);

await openRowMenu({ kind: 'group' });
await choose('Send all to back');
const groupBack = await rows();
const groupIndex = groupBack.findIndex((r) => r.kind === 'group');
const priceIndex = groupBack.findIndex((r) => r.kind === 'price');
assert(groupIndex > priceIndex, 'the group moves behind the candles', { groupBack, groupIndex, priceIndex });
const groupZ = await page.evaluate(() =>
    window.__ws.active.chart.drawings
        .all()
        .filter((d) => d.id === 'dw-1' || d.id === 'dw-2')
        .map((d) => d.zIndex)
        .sort((a, b) => a - b),
);
assert(groupZ.length === 2 && groupZ[1] - groupZ[0] === 1, "group members keep sequential z-indexes", groupZ);

assert(errors.length === 0, 'no page errors during visual-order edits', errors.slice(0, 3));
await browser.close();
report('object-tree-visual-order', {
    initial: { rows: initialRows, paint: initialPaint },
    back: { rows: backRows, paint: backPaint },
    front: { rows: frontRows, paint: frontPaint },
    indicatorFront: indicatorFront[0],
    indicatorBack: indicatorBack.at(-1),
    priceFront: priceFront[0],
    priceBack: priceBack.at(-1),
    group: { first: groupFront[0], backIndex: groupIndex, z: groupZ },
    menu: menuItems.filter((x) => /Bring|Send/.test(x)),
});
