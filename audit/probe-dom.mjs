import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5190/offline.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);
const tree = await page.evaluate(() => {
  const root = document.querySelector('.vela-ws-root, [class*="vela-ws-root"]') ?? document.querySelector('[data-layout] > *')?.parentElement;
  const walk = (el, d = 0) => {
    const out = [`${'  '.repeat(d)}<${el.tagName.toLowerCase()} class="${el.className}">${el.children.length === 0 ? ' ' + el.textContent.slice(0, 24) : ''}`];
    if (d < 2) for (const c of el.children) out.push(...walk(c, d + 1));
    return out;
  };
  return { rootClass: root?.className, kids: [...(root?.children ?? [])].map((c) => `${c.tagName.toLowerCase()}.${c.className}`), tree: walk(root).slice(0, 40) };
});
await page.locator('.vela-mb-more').tap();
await page.waitForTimeout(400);
const withDrawer = await page.evaluate(() => {
  const drawer = document.querySelector('.vela-drawer-positioner');
  const parent = drawer?.parentElement;
  return { parentClass: parent?.className, parentKids: [...(parent?.children ?? [])].map((c) => `${c.tagName.toLowerCase()}.${c.className}`) };
});
console.log(JSON.stringify({ ...tree, withDrawer }, null, 1));
await browser.close();
