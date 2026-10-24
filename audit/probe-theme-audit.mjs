// Light-theme audit: which surfaces actually re-theme? The chart pane does; the shell
// chrome is the question. Reads computed styles per surface rather than eyeballing.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const read = () => p.evaluate(() => {
    const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, fg: s.color };
    };
    return {
        topbar: pick('[class*=topbar], header'),
        sidebar: pick('[class*=toolbar]'),
        bottombar: pick('[class*=bottombar], footer'),
        cellHeader: pick('[class*=cell-head], [class*=cellHead]'),
        body: pick('body'),
        tokens: {
            bg: getComputedStyle(document.documentElement).getPropertyValue('--vela-bg').trim(),
            fg: getComputedStyle(document.documentElement).getPropertyValue('--vela-fg').trim(),
        },
    };
});

const dark = await read();
await p.evaluate(() => window.__ws.setTheme('light'));
await p.waitForTimeout(1200);
const light = await read();
console.log(JSON.stringify({ dark, light }, null, 1));
await b.close();
