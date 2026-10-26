// One tooltip surface for the whole shell (R69).
//
// A tooltip used to be its own floating layer, built with the trigger and left in the document
// hidden — ~46 nodes and a Zag machine's listeners for every control in the topbar, the status
// line and the bottom bar. They are now ONE surface, built by the first open, and this check is
// what keeps it honest: nothing at rest, the same node re-used by a second trigger, the same
// geometry Zag produced (8px off the side, centred, flipped inside the bar), the right ARIA, a
// rich tip that leaves nothing behind, Escape/focus, and no tip at all on a tap.
import { open, assert, report } from './helpers.mjs';

const { page, errors, browser } = await open({ settle: 2000 });
const facts = {};

// ── 1: at rest the page carries no tooltip node ─────────────────────────────────────────
const rest = await page.evaluate(() => ({
    tips: document.querySelectorAll('.vela-tooltip').length,
    nodes: document.body.querySelectorAll('*').length,
    triggers: document.querySelectorAll('[data-vela-tip]').length,
}));
facts.rest = rest;
assert(rest.tips === 0, 'a page at rest carries no tooltip surface', rest);
assert(rest.triggers > 15, 'every topbar/status-bar control is still a registered trigger', rest);

// ── 2: hover the timeframe caret — instant, centred, 8px under the bar, ARIA on ─────────
const tf = await page.locator('#vela-topbar-tf').boundingBox();
await page.locator('#vela-topbar-tf').hover();
await page.waitForTimeout(160);
const first = await page.evaluate(() => {
    const t = document.querySelector('.vela-tooltip');
    const trig = document.querySelector('#vela-topbar-tf');
    return t
        ? {
              text: t.textContent,
              id: t.id,
              role: t.getAttribute('role'),
              state: t.dataset.state,
              hidden: t.hidden,
              rect: t.getBoundingClientRect().toJSON(),
              same: document.querySelectorAll('.vela-tooltip').length,
              trigState: trig.dataset.state,
              described: trig.getAttribute('aria-describedby'),
              layer: t.parentElement.className,
          }
        : null;
});
facts.first = first;
assert(!!first && first.text === 'Timeframe', 'hovering the caret shows its tip', first?.text);
assert(first?.role === 'tooltip' && first?.described === first?.id, 'the tip is a described tooltip', first);
assert(first?.trigState === 'open' && first?.state === 'open', 'both ends report open', first);
assert(
    Math.abs(first.rect.left + first.rect.width / 2 - (tf.x + tf.width / 2)) <= 1.5,
    'the tip is centred on its trigger',
    { tip: first.rect, trigger: tf },
);
assert(Math.abs(first.rect.top - (tf.y + tf.height) - 8) <= 1.5, '…8px off its side (flipped below the bar)', { tip: first.rect.top, triggerBottom: tf.y + tf.height });

// ── 3: leaving clears it, and the surface keeps its single node ────────────────────────
await page.mouse.move(700, 520);
await page.waitForTimeout(160);
const after = await page.evaluate(() => {
    const t = document.querySelector('.vela-tooltip');
    return { hidden: t.hidden, state: t.dataset.state, text: t.childNodes.length, described: document.querySelector('#vela-topbar-tf').getAttribute('aria-describedby'), tips: document.querySelectorAll('.vela-tooltip').length };
});
facts.after = after;
assert(after.hidden && after.state === 'closed', 'leaving hides the tip', after);
assert(after.described === null, 'and drops the trigger’s aria hook', after);
assert(after.tips === 1, 'the surface itself stays — one node, reused', after);

// ── 4: a second trigger re-uses the same element (identity, not just a count) ──────────
await page.evaluate(() => (document.querySelector('.vela-tooltip').dataset.marker = 'r69'));
const second = await page.locator('.vela-widget-topbar .vela-widget-compare').first().boundingBox();
await page.locator('.vela-widget-topbar .vela-widget-compare').first().hover();
await page.waitForTimeout(160);
const reuse = await page.evaluate(() => {
    const t = document.querySelector('.vela-tooltip');
    return { marker: t.dataset.marker ?? null, text: t.textContent, tips: document.querySelectorAll('.vela-tooltip').length, rect: t.getBoundingClientRect().toJSON() };
});
facts.reuse = reuse;
assert(reuse.marker === 'r69', 'the same surface node serves the next trigger', reuse);
assert(typeof reuse.text === 'string' && reuse.text.length > 0, '…with that trigger own label', reuse);
assert(
    Math.abs(reuse.rect.left + reuse.rect.width / 2 - (second.x + second.width / 2)) <= 1.5,
    '…re-centred on the new trigger',
    { tip: reuse.rect, trigger: second },
);

// ── 5: the status line asks for `bottom` and gets it ───────────────────────────────────
const market = await page.locator('.vela-sl-market').first().boundingBox();
await page.locator('.vela-sl-market').first().hover();
await page.waitForTimeout(160);
const bottom = await page.evaluate(() => {
    const t = document.querySelector('.vela-tooltip');
    return { text: t.textContent, placement: t.dataset.placement, rect: t.getBoundingClientRect().toJSON() };
});
facts.bottom = bottom;
assert(bottom.placement === 'bottom', 'a bottom-placed tip keeps its side', bottom);
assert(Math.abs(bottom.rect.top - (market.y + market.height) - 8) <= 1.5, '…8px under the market badge', { tip: bottom.rect.top, bottom: market.y + market.height });

// ── 6: Escape closes it; keyboard focus opens one ──────────────────────────────────────
await page.keyboard.press('Escape');
await page.waitForTimeout(120);
const escaped = await page.evaluate(() => document.querySelector('.vela-tooltip').hidden);
assert(escaped === true, 'Escape closes the tip', escaped);

await page.evaluate(() => document.querySelector('#vela-topbar-style').focus());
await page.waitForTimeout(160);
const focused = await page.evaluate(() => ({ hidden: document.querySelector('.vela-tooltip').hidden, text: document.querySelector('.vela-tooltip').textContent }));
facts.focused = focused;
assert(focused.hidden === false && focused.text === 'Chart style', 'keyboard focus shows the same tip', focused);

// ── 7: a rich (node) tip leaves nothing behind ─────────────────────────────────────────
await page.mouse.move(700, 520);
await page.keyboard.press('Escape');
// The status line's sync badge opens the layout picker (its info badge carries a rich tip).
await page.locator('.vela-sl-marks').first().click();
await page.waitForSelector('.vela-lp', { timeout: 5000 });
await page.locator('.vela-lp-badge').hover();
await page.waitForTimeout(180);
const rich = await page.evaluate(() => {
    const t = document.querySelector('.vela-tooltip');
    return { kids: t.childNodes.length, nodes: t.querySelectorAll('*').length, text: (t.textContent ?? '').slice(0, 40), hidden: t.hidden };
});
facts.rich = rich;
assert(rich.hidden === false && rich.kids > 0, 'the layout picker’s rich tip renders its node', rich);
await page.mouse.move(700, 520);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const richGone = await page.evaluate(() => {
    const t = document.querySelector('.vela-tooltip');
    return { kids: t.childNodes.length, hidden: t.hidden, total: document.body.querySelectorAll('*').length };
});
facts.richGone = richGone;
assert(richGone.kids === 0 && richGone.hidden, 'closing a rich tip empties the shared surface', richGone);

facts.desktopNodes = await page.evaluate(() => document.body.querySelectorAll('*').length);
await browser.close();

// ── 8: a phone never opens one — no hover, and a tap must not flash a tip ──────────────
const phone = await open({ settle: 1800, mobile: true, viewport: { width: 390, height: 780 } });
const pfacts = await phone.page.evaluate(() => ({ tips: document.querySelectorAll('.vela-tooltip').length, nodes: document.body.querySelectorAll('*').length }));
await phone.page.locator('.vela-mb-tf').click();
await phone.page.waitForTimeout(200);
const tapped = await phone.page.evaluate(() => ({ tips: document.querySelectorAll('.vela-tooltip').length, open: document.querySelectorAll('.vela-tooltip[data-state="open"]').length }));
pfacts.tapped = tapped;
facts.phone = pfacts;
assert(pfacts.tips === 0 && tapped.open === 0, 'a phone carries no tooltip surface, even after a tap', pfacts);
errors.push(...phone.errors);
await phone.browser.close();

assert(errors.length === 0, 'no page errors', errors);
report('tooltip-surface', facts);
