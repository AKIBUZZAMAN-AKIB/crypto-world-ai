import { chromium } from 'playwright';
const OUT = '/home/user/shots';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const facts = {};

async function open(vp) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

// arm a tool straight through the headless drawings API (the pill mirrors it)
async function arm(page, tool = 'trendline') {
  await page.evaluate((t) => window.__ws.cells()[0].chart.drawings.setTool(t), tool);
  await page.waitForTimeout(350);
}

for (const w of [320, 390]) {
  const { ctx, page } = await open({ width: w, height: 780 });
  await arm(page);
  facts[`pill${w}`] = await page.evaluate(() => {
    const el = document.querySelector('.vela-drawpill');
    const dock = el?.parentElement;
    const r = el?.getBoundingClientRect();
    const dr = dock?.getBoundingClientRect();
    const grid = document.querySelector('.vela-ws-grid')?.getBoundingClientRect();
    const bar = document.querySelector('.vela-mobilebar')?.getBoundingClientRect();
    const btns = [...(el?.children ?? [])].map((b) => {
      const br = b.getBoundingClientRect();
      return { cls: b.className.replace('vela-drawpill-', ''), w: Math.round(br.width), h: Math.round(br.height), disabled: b.disabled === true };
    });
    return {
      hidden: el?.hidden ?? null,
      strip: r ? { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width), sw: el.scrollWidth, cw: el.clientWidth } : null,
      dockH: dr ? Math.round(dr.height) : null,
      gridBottom: grid ? Math.round(grid.bottom) : null,
      barTop: bar ? Math.round(bar.top) : null,
      coversPlot: !!(r && grid && r.top < grid.bottom),
      btns,
    };
  });
  // a real placement, then undo/redo become live
  facts[`pill${w}`].glyph = await page.evaluate(() => {
    const g = document.querySelector('.vela-drawpill-tool');
    return { svg: !!g?.querySelector('svg'), label: g?.getAttribute('aria-label') };
  });
  const box = await page.locator('.vela-ws-grid canvas').first().boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  facts[`pill${w}`].afterDraw = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.vela-drawpill-btn')];
    return { undo: b[0]?.disabled, redo: b[1]?.disabled, labels: b.map((x) => x.getAttribute('aria-label')) };
  });
  await page.screenshot({ path: `${OUT}/40-pill-${w}.png` });

  // the ⋯ menu
  await page.locator('.vela-drawpill-btn').nth(4).tap();
  await page.waitForTimeout(400);
  facts[`pill${w}`].more = await page.evaluate(() => {
    const surf = [...document.querySelectorAll('.vela-menu-surface, [data-vela-menu], .vela-menu')].pop();
    const rows = [...(surf?.querySelectorAll('[role="menuitem"]') ?? [])].map((r) => r.textContent?.trim());
    return { rows, n: rows.length };
  });
  await page.screenshot({ path: `${OUT}/40-pill-more-${w}.png` });
  await ctx.close();
}

// drawing bar hidden again after the tool is put down
{
  const { ctx, page } = await open({ width: 390, height: 780 });
  await arm(page);
  const before = await page.evaluate(() => document.querySelector('.vela-drawpill')?.getBoundingClientRect().height);
  await page.evaluate(() => window.__ws.cells()[0].chart.drawings.setTool(null));
  await page.waitForTimeout(300);
  facts.hidden = {
    beforeH: Math.round(before ?? 0),
    dockH: await page.evaluate(() => Math.round(document.querySelector('.vela-ws-drawdock')?.getBoundingClientRect().height ?? -1)),
    hidden: await page.evaluate(() => document.querySelector('.vela-drawpill')?.hidden),
  };
  await ctx.close();
}

console.log(JSON.stringify(facts, null, 1));
await browser.close();
