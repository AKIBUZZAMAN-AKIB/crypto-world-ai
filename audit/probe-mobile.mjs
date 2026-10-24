// Mobile quality probe: touch-target sizes, overflow, and the two most-used sheets.
// Apple/Material both ask for >=44x44 CSS px; a premium chart that ships 28px buttons
// is the single most common "feels cheap" tell on a phone.
import { chromium, devices } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

const audit = async (label) => p.evaluate((where) => {
    const els = [...document.querySelectorAll('button, [role=button], a, input, [tabindex]:not([tabindex="-1"])')];
    const small = [];
    /** How far a FINGER can be from the centre and still hit this element — the number that
     *  matters. A visual 30px chip with a 44px ::after is a 44px target, and reading only
     *  `getBoundingClientRect` would call it a failure. */
    const hitSpan = (el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const owns = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t) || t.contains(el)); };
        let up = 0, down = 0, left = 0, right = 0;
        for (let d = 1; d <= 26; d += 1) { if (owns(cx, cy - d)) up = d; else break; }
        for (let d = 1; d <= 26; d += 1) { if (owns(cx, cy + d)) down = d; else break; }
        for (let d = 1; d <= 26; d += 1) { if (owns(cx - d, cy)) left = d; else break; }
        for (let d = 1; d <= 26; d += 1) { if (owns(cx + d, cy)) right = d; else break; }
        return { w: left + right, h: up + down };
    };
    for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 || r.height < 44) {
            // An element UNDER a modal/drawer is not reachable at all — that is the modal's
            // job, not a target-size failure.
            const covered = (() => { const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !t || !(t === el || el.contains(t)); })();
            if (covered) continue;
            const hit = hitSpan(el);
            if (hit.w >= 44 && hit.h >= 44) continue; // drawn small, tappable enough
            small.push({
                tag: el.tagName.toLowerCase(),
                cls: (el.className || '').toString().slice(0, 28),
                label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 22),
                w: Math.round(r.width), h: Math.round(r.height),
                hitW: hit.w, hitH: hit.h,
            });
        }
    }
    const doc = document.documentElement;
    return {
        where,
        interactive: els.length,
        under44: small.length,
        worst: small.sort((a, z) => a.w * a.h - z.w * z.h).slice(0, 8),
        hOverflow: doc.scrollWidth > doc.clientWidth + 1 ? `${doc.scrollWidth}>${doc.clientWidth}` : 'none',
    };
}, label);

const out = [];
out.push(await audit('home'));
await p.evaluate(() => window.__ws.openMoreDrawer?.());
await p.waitForTimeout(900);
out.push(await audit('more drawer'));
await p.screenshot({ path: 'shots/96-mobile-more.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.evaluate(() => window.__ws.openAlertCreate?.());
await p.waitForTimeout(900);
out.push(await audit('alert sheet'));
await p.screenshot({ path: 'shots/97-mobile-alert.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.evaluate(() => window.__ws.openIndicators?.());
await p.waitForTimeout(1000);
out.push(await audit('indicator picker'));
await p.screenshot({ path: 'shots/98-mobile-indicators.png' });

console.log(JSON.stringify({ out, errors: errors.slice(0, 3) }, null, 1));
await b.close();
