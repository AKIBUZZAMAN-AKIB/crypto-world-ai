// R87 — Premium surfaces. A single, OPT-IN design layer that every floating panel
// inherits through the shared UI kit (dialog / drawer / popover) and the widget's own
// panel families. It is deliberately a SEPARATE, last-injected sheet: the individual
// panels keep owning their layout and behaviour; this sheet owns the visual language —
// elevation, type, spacing, radius, focus, and the six interaction microstates.
//
// Why one sheet and not one edit per panel: the panels are ten independently-written
// CSS blocks with their own drift. Restyling each one leaves ten edge cases and no shared
// vocabulary. Scoping every rule under `html.vela-premium` (a marker this module puts on
// the document root) gives a specificity of 0,2,1+ — above the panels' 0,1,0 rules —
// so the layer wins regardless of the order each panel injects its own sheet. It also
// means the layer is inert unless a host opts in, so embedded single-chart widgets that
// never call installPremiumStyles() are untouched.
//
// Design decisions (research: Linear/Vercel/Stripe dark systems + TradingView Supercharts):
//   • Elevation in a dark theme reads as LIGHTER surfaces, not bigger shadows. Four steps:
//     page → panel → raised card → hover/active, each separated by a hairline border and
//     a 1px top highlight, with a soft layered shadow only on the floating shell.
//   • Colour is restraint: one accent for selection/focus/primary, semantic up/down for
//     market values, everything else a neutral ramp.
//   • Spacing on a 4/8/12/16/24 scale; radii 6/10/14/18; type 10/11.5/13/15 with a
//     strict eyebrow → title → subtitle → body → meta hierarchy.
//   • Every interactive element owns all six microstates: default, hover, focus-visible,
//     active (pressed), disabled, and loading (a scoped shimmer).
export const PREMIUM_STYLE_ID = 'vela-premium-surfaces';

export const PREMIUM_CSS = `
/* ── tokens ──────────────────────────────────────────────────────────────── */
/* The theme tokens (--vela-border-strong, --vela-accent, --vela-surface-elev …)
   are written as INLINE custom properties on each floating .vela-ui-layer host
   and on the widget root (see ui/tokens.ts) — they are NOT on <html>. A custom
   property that references var(--vela-*) resolves at the element where it is
   DECLARED, so declaring the whole ramp only on <html> leaves every derived
   token invalid there and the panels inherit the invalid value. Declaring the
   ramp on the hosts too makes color-mix() resolve against the LIVE theme. */
html.vela-premium,
html.vela-premium .vela-ui,
html.vela-premium .vela-ui-layer,
html.vela-premium .vela-workspace {
    --vp-r-xs: 5px;
    --vp-r-sm: 7px;
    --vp-r-md: 10px;
    --vp-r-lg: 14px;
    --vp-r-xl: 18px;
    --vp-ease: cubic-bezier(.22, 1, .36, 1);
    --vp-t: 160ms var(--vp-ease);
    --vp-line: color-mix(in srgb, var(--vela-border-strong) 82%, var(--vela-fg-bright));
    --vp-line-soft: var(--vela-border-faint);
    --vp-top-hi: inset 0 1px 0 rgba(255,255,255,.05);
    --vp-sh-1: 0 1px 2px rgba(0,0,0,.32), var(--vp-top-hi);
    --vp-sh-2: 0 10px 30px rgba(0,0,0,.44), 0 2px 8px rgba(0,0,0,.28), var(--vp-top-hi);
    --vp-sh-3: 0 30px 72px rgba(0,0,0,.6), 0 10px 26px rgba(0,0,0,.4), var(--vp-top-hi);
    --vp-ring: 0 0 0 2px var(--vela-surface-elev), 0 0 0 4px color-mix(in srgb, var(--vela-accent-ink, var(--vela-accent)) 72%, transparent);
    /* Four elevation steps. color-mix keeps them theme-aware: on a dark plot the bright
       foreground lightens a surface; on a light plot it darkens it into a recess, which
       the border+shadow then lift. Palette-exempt: no raw brand hex — all derived. */
    --vp-e0: var(--vela-bg);
    --vp-e1: var(--vela-surface-elev);
    --vp-e2: color-mix(in srgb, var(--vela-panel) 90%, var(--vela-fg-bright));
    --vp-e3: color-mix(in srgb, var(--vela-panel) 79%, var(--vela-fg-bright));
    --vp-ink: var(--vela-fg);
    --vp-ink-hi: var(--vela-fg-bright);
    --vp-ink-mu: var(--vela-fg-muted);
    --vp-ink-fa: var(--vela-fg-faint);
    /* The filled accent and its foreground are a pair. Text accents use their
       theme-aware ink token; market and drawing colours stay independent. */
    --vp-accent: var(--vela-accent);
    --vp-accent-ink: var(--vela-accent-ink, var(--vela-accent));
    --vp-accent-wash: color-mix(in srgb, var(--vela-accent) 12%, transparent);
    --vp-accent-line: color-mix(in srgb, var(--vela-accent) 35%, transparent);
}
html.vela-premium :is(.vela-widget-topbar, .vela-mobilebar, .vela-panel, .vela-dialog,
    .vela-drawer, .vela-popover, .vela-lp, .vela-menu) {
    --vela-selected-bg: var(--vela-accent) !important;
    --vela-selected-fg: var(--vela-fg-on-fill) !important;
}

/* ── backdrops: dim + a whisper of blur, never a flat black curtain ───────── */
html.vela-premium .vela-dialog-backdrop:not(.vela-dialog-backdrop--clear),
html.vela-premium .vela-drawer-backdrop {
    background: color-mix(in srgb, var(--vela-backdrop) 88%, transparent);
    backdrop-filter: blur(6px) saturate(1.1);
    -webkit-backdrop-filter: blur(6px) saturate(1.1);
}

/* ── the shared shells (dialog, drawer) — elevation level 1 ──────────────── */
html.vela-premium .vela-dialog,
html.vela-premium .vela-drawer {
    background:
        linear-gradient(180deg, color-mix(in srgb, var(--vela-surface-elev) 93%, var(--vela-fg-bright)) 0%, var(--vela-surface-elev) 96px),
        var(--vela-surface-elev);
    border: 1px solid var(--vp-line);
    box-shadow: var(--vp-sh-3);
    border-radius: var(--vp-r-lg);
    color: var(--vp-ink);
    transition: box-shadow var(--vp-t), border-color var(--vp-t);
}
html.vela-premium .vela-drawer { border-bottom: none; border-radius: var(--vp-r-xl) var(--vp-r-xl) 0 0; }
@media (min-width: 720px) {
    html.vela-premium .vela-drawer { border-radius: var(--vp-r-lg); }
}

/* Panel roots (popover children + side panels) — same surface, their own radius. */
html.vela-premium :is(.vela-tm, .vela-lm, .vela-lp, .vela-tm-dialog, .vela-lm-dialog) {
    background: var(--vp-e1);
    border: 1px solid var(--vp-line);
    border-radius: var(--vp-r-lg);
    box-shadow: var(--vp-sh-3);
    color: var(--vp-ink);
}
html.vela-premium .vela-popover :is(.vela-tm, .vela-lm, .vela-lp) { border-radius: var(--vp-r-lg); }
/* The dialog already supplies the outer card; avoid a second framed card and a
   duplicate title inside it. */
html.vela-premium .vela-tm-dialog .vela-tm { border: 0; box-shadow: none; background: transparent; }
html.vela-premium .vela-tm-dialog .vela-tm-head { display: none; }

/* ── headers: eyebrow → title → subtitle, with an accent icon tile ────────── */
html.vela-premium :is(.vela-dialog-header, .vela-tm-head, .vela-lm-head, .vela-lp-head, .vela-lp-panehead, .vela-ip-head, .vela-md-panehead) {
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--vp-line-soft);
}
html.vela-premium :is(.vela-lp-panemark, .vela-md-panemark) {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--vela-mono-muted, var(--vela-fg-muted));
    box-shadow: none;
}
html.vela-premium :is(.vela-lp-panetitle, .vela-md-panetitle) {
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -.01em;
    color: var(--vp-ink-hi);
}
html.vela-premium :is(.vela-lp-panekicker, .vela-lp-panehint) {
    font-size: 10px;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--vp-ink-mu);
}
html.vela-premium .vela-lp-panehint { text-transform: none; letter-spacing: 0; font-size: 11px; }
/* The kicker is a real element (dialog view), a ::before (data-kicker heads) or the
   pane head's own span — normalise all three to one eyebrow style. */
html.vela-premium :is(.vela-dialog-kicker, .vela-md-panekicker) {
    display: block;
    font-size: 9.5px;
    font-weight: 750;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--vp-ink-mu);
    margin: 0 0 3px;
}
html.vela-premium .vela-dialog-title,
html.vela-premium :is(.vela-tm-title, .vela-lm-title, .vela-ip-title, .vela-md-panetitle) {
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -.01em;
    color: var(--vp-ink-hi);
    line-height: 1.25;
}
html.vela-premium :is(.vela-tm-sub, .vela-lm-meta, .vela-ip-sub, .vela-md-panehint) {
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--vp-ink-mu);
}
/* Icon tile: a raised, accent-tinted square. */
html.vela-premium :is(.vela-tm-mark, .vela-lm-mark, .vela-ip-mark, .vela-md-panemark, .vela-prem-tile) {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 0;
    background: transparent;
    border: 0;
    color: var(--vela-mono-muted, var(--vela-fg-muted));
    box-shadow: none;
    font-size: 15px;
}
html.vela-premium :is(.vela-tm-mark, .vela-lm-mark, .vela-ip-mark, .vela-md-panemark, .vela-prem-tile) .vela-icon { font-size: 15px; width: 15px; height: 15px; }
/* The kicker line — a small-caps label above the title. Panels opt in with data-kicker. */
html.vela-premium [data-kicker]::before {
    content: attr(data-kicker);
    display: block;
    font-size: 9.5px;
    font-weight: 750;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--vp-ink-mu);
    margin: 0 0 3px;
}
html.vela-premium .vela-dialog-close {
    width: 30px;
    height: 30px;
    border-radius: var(--vp-r-sm);
    color: var(--vp-ink-mu);
    border: 1px solid transparent;
    transition: background var(--vp-t), color var(--vp-t), border-color var(--vp-t);
}
html.vela-premium .vela-dialog-close:hover { background: var(--vp-e2); color: var(--vp-ink-hi); border-color: var(--vp-line-soft); }
html.vela-premium .vela-dialog-close:focus-visible { outline: none; box-shadow: var(--vp-ring); }
html.vela-premium .vela-dialog-close:active { transform: scale(.94); }

/* ── section labels (eyebrow rows inside a panel) ────────────────────────── */
html.vela-premium :is(.vela-md-section, .vela-tm-group, .vela-lm-sect, .vela-lm-section,
    .vela-ip-group, .vela-lp-heading, .vela-ot-lg-head, .vela-ot-panehead, .vela-dw-group,
    .vela-md-sublabel, .vela-wl-sortrow, .vela-panel-title) {
    font-size: 10px;
    font-weight: 750;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--vp-ink-mu);
}
html.vela-premium :is(.vela-dialog-body, .vela-drawer-body, .vela-tm, .vela-lm, .vela-lp) {
    scrollbar-width: thin;
    scrollbar-color: var(--vp-ink-fa) transparent;
}

/* ── segmented controls (tabs) — elevation level 2 track, level 3 active ─── */
html.vela-premium :is(.vela-tm-tabs, .vela-ip-tabs, .vela-md-navtrack, .vela-md-seg,
    .vela-ot-mo-segment, .vela-sd-tabs) {
    gap: 3px;
    padding: 4px;
    border: 1px solid var(--vp-line-soft);
    border-radius: var(--vp-r-md);
    background: var(--vp-e0);
    box-shadow: inset 0 1px 2px rgba(0,0,0,.22);
}
html.vela-premium :is(.vela-tm-tab, .vela-ip-tab, .vela-md-navbtn, .vela-md-segbtn,
    .vela-ot-mo-segment > *, .vela-sd-tab) {
    border-radius: var(--vp-r-sm);
    color: var(--vp-ink-mu);
    font-size: 11.5px;
    font-weight: 650;
    letter-spacing: .01em;
    background: transparent;
    border: 1px solid transparent;
    transition: background var(--vp-t), color var(--vp-t), box-shadow var(--vp-t), border-color var(--vp-t), transform var(--vp-t);
}
html.vela-premium :is(.vela-tm-tab, .vela-ip-tab, .vela-md-navbtn, .vela-md-segbtn, .vela-sd-tab):hover {
    background: var(--vp-e2);
    color: var(--vp-ink-hi);
}
html.vela-premium :is(.vela-tm-tab[data-active='1'], .vela-tm-tab[data-active], .vela-ip-tab[data-active],
    .vela-md-navbtn[data-active], .vela-md-segbtn[data-active], .vela-sd-tab[data-active]) {
    background: var(--vp-e3);
    color: var(--vp-ink-hi);
    border-color: var(--vp-line-soft);
    box-shadow: var(--vp-sh-1);
}
html.vela-premium :is(.vela-tm-tab, .vela-ip-tab, .vela-md-navbtn, .vela-md-segbtn):focus-visible {
    outline: none;
    box-shadow: var(--vp-ring);
}
html.vela-premium :is(.vela-tm-tab, .vela-ip-tab, .vela-md-navbtn, .vela-md-segbtn):active { transform: scale(.97); }
/* Keep every tab at its natural width; the strip scrolls rather than squashing,
   wrapping or hiding its labels. Native touch scrolling coexists with drawer swipes. */
html.vela-premium :is(.vela-tm-tabs, .vela-ip-tabs, .vela-sp-tabs, .vela-dd-tabs,
    .vela-st-tabs, .vela-sd-itabs, .vela-sd-mobile .vela-sd-toc,
    .vela-ot-mo-segment, .vela-md-seg) {
    display: flex;
    flex-wrap: nowrap;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x;
    scrollbar-width: thin;
}
html.vela-premium :is(.vela-tm-tabs, .vela-ip-tabs, .vela-sp-tabs, .vela-dd-tabs,
    .vela-st-tabs, .vela-sd-itabs, .vela-sd-mobile .vela-sd-toc,
    .vela-ot-mo-segment, .vela-md-seg) > * { flex: 0 0 auto; white-space: nowrap; }
html.vela-premium .vela-st-tab { padding-inline: 10px; overflow: visible; text-overflow: clip; }
/* Popover panel headers are handles; small select/color popovers remain anchored. */
html.vela-premium :is(.vela-popover .vela-tm-head, .vela-popover .vela-lm-head) { cursor: grab; touch-action: none; }
html.vela-premium :is(.vela-popover .vela-tm-head, .vela-popover .vela-lm-head):focus-visible { outline: 2px solid var(--vela-fg-bright); outline-offset: -2px; }
/* The one accent belongs to selection in the indicator template tabs. Keep it, but
   restrained: a wash + accent text, not a saturated blue pill. */
html.vela-premium .vela-tm-tab[data-active='1'] {
    background: var(--vp-accent-wash);
    color: var(--vp-accent-ink);
    border-color: var(--vp-accent-line);
    box-shadow: var(--vp-sh-1);
}

/* ── rows & cards — elevation level 2, all six microstates ───────────────── */
html.vela-premium :is(.vela-tm-row, .vela-ip-row, .vela-lm-row, .vela-lm-srow, .vela-md-row,
    .vela-md-lrow, .vela-md-sync, .vela-ot-row, .vela-ot-lg-row, .vela-ot-mo-row,
    .vela-wl-row, .vela-dw-row, .vela-lp-srow) {
    border-radius: var(--vp-r-sm);
    border: 1px solid transparent;
    background: transparent;
    transition: background var(--vp-t), border-color var(--vp-t), box-shadow var(--vp-t), transform var(--vp-t);
}
html.vela-premium :is(.vela-tm-row, .vela-ip-row, .vela-lm-row, .vela-md-row, .vela-md-lrow,
    .vela-md-sync, .vela-ot-row, .vela-wl-row, .vela-dw-row):hover {
    background: var(--vp-e2);
    border-color: var(--vp-line-soft);
}
html.vela-premium :is(.vela-tm-row, .vela-ip-row, .vela-lm-row, .vela-md-row, .vela-md-lrow,
    .vela-md-sync, .vela-ot-row, .vela-wl-row, .vela-dw-row):focus-visible {
    outline: none;
    box-shadow: var(--vp-ring);
}
html.vela-premium :is(.vela-tm-row, .vela-ip-row, .vela-lm-row, .vela-md-row, .vela-md-lrow,
    .vela-md-sync, .vela-ot-row, .vela-wl-row, .vela-dw-row):active { transform: scale(.995); }
html.vela-premium :is(.vela-tm-row[data-current='1'], .vela-md-row[data-checked='1'],
    .vela-ot-row[data-selected='1']) {
    background: var(--vp-accent-wash);
    border-color: var(--vp-accent-line);
}
html.vela-premium :is(button, [role='button'])[aria-disabled='true']:is(.vela-tm-row, .vela-ip-row,
    .vela-md-row, .vela-ot-row, .vela-wl-row) { opacity: .42; pointer-events: none; }

/* Tiles / preset cards: raised surface with a crisp selected state. */
html.vela-premium :is(.vela-md-preset, .vela-lp-preset, .vela-lp-thumb,
    .vela-tm-glyph, .vela-oncard, .vela-ip-oncard, .vela-md-hero) {
    border-radius: var(--vp-r-md);
    background: var(--vp-e2);
    border: 1px solid var(--vp-line-soft);
    box-shadow: var(--vp-sh-1);
    transition: background var(--vp-t), border-color var(--vp-t), box-shadow var(--vp-t), transform var(--vp-t);
}
html.vela-premium :is(.vela-md-preset, .vela-lp-preset):hover {
    background: var(--vp-e3);
    border-color: var(--vp-line);
    transform: translateY(-1px);
}
html.vela-premium :is(.vela-md-preset, .vela-lp-preset):focus-visible { outline: none; box-shadow: var(--vp-ring); }
html.vela-premium :is(.vela-md-preset, .vela-lp-preset):active { transform: translateY(0) scale(.98); }
html.vela-premium :is(.vela-md-preset[data-checked='1'], .vela-lp-preset[data-checked='1']) {
    background: var(--vp-accent-wash);
    border-color: var(--vp-accent-line);
    box-shadow: var(--vp-sh-1), inset 0 0 0 1px var(--vp-accent-line);
}

/* Layout canvas cells are square controls, not rounded preset cards. The canvas
   publishes data-on, not data-active: keep the live selection/hover rectangle visible. */
html.vela-premium .vela-lp-sq {
    border-radius: 4px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-faint);
    box-shadow: none;
}
html.vela-premium .vela-lp-sq:hover { background: var(--vela-hover-strong); border-color: var(--vela-border-strong); }
html.vela-premium .vela-lp-sq[data-on='1'] { background: var(--vela-accent-ink, var(--vela-accent)); border-color: var(--vela-accent-ink, var(--vela-accent)); }

/* ── buttons: primary / secondary / ghost, six states ────────────────────── */
html.vela-premium :is(.vela-dialog-btn, .vela-lm-btn, .vela-lm-primary, .vela-tm-chip,
    .vela-tm-primary, .vela-ip-verb, .vela-md-lact, .vela-md-lghost, .vela-lp-managerdoor,
    .vela-lp-save, .vela-ot-btn, .vela-wl-add) {
    border-radius: var(--vp-r-sm);
    border: 1px solid var(--vp-line);
    background: var(--vp-e2);
    color: var(--vp-ink);
    font-weight: 600;
    font-size: 12px;
    letter-spacing: .005em;
    transition: background var(--vp-t), color var(--vp-t), border-color var(--vp-t), box-shadow var(--vp-t), transform var(--vp-t), opacity var(--vp-t);
}
html.vela-premium :is(.vela-dialog-btn, .vela-lm-btn, .vela-tm-chip, .vela-ip-verb, .vela-md-lact, .vela-md-lghost, .vela-lp-managerdoor, .vela-ot-btn, .vela-wl-add):hover {
    background: var(--vp-e3);
    color: var(--vp-ink-hi);
    border-color: var(--vp-line);
}
html.vela-premium :is(.vela-dialog-btn, .vela-lm-btn, .vela-tm-chip, .vela-ip-verb, .vela-md-lact, .vela-md-lghost, .vela-lp-managerdoor, .vela-ot-btn, .vela-wl-add):focus-visible {
    outline: none;
    box-shadow: var(--vp-ring);
}
html.vela-premium :is(.vela-dialog-btn, .vela-lm-btn, .vela-tm-chip, .vela-ip-verb, .vela-md-lact, .vela-md-lghost, .vela-lp-managerdoor, .vela-ot-btn, .vela-wl-add):active { transform: scale(.97); }
html.vela-premium :is(.vela-dialog-btn-primary, .vela-lm-primary, .vela-tm-primary) {
    background: var(--vp-accent);
    color: var(--vela-fg-on-fill);
    border-color: transparent;
    box-shadow: var(--vp-sh-1);
}
html.vela-premium :is(.vela-dialog-btn-primary, .vela-lm-primary, .vela-tm-primary):hover {
    background: color-mix(in srgb, var(--vp-accent) 92%, #000);
    color: var(--vela-fg-on-fill);
    filter: none;
}
html.vela-premium :is(button, [role='button']):disabled { opacity: .4; cursor: default; box-shadow: none; transform: none; }
/* Loading: a scoped shimmer that only appears when a host marks the element. */
@keyframes vela-vp-shimmer { from { background-position: -180% 0; } to { background-position: 180% 0; } }
html.vela-premium [data-loading='1'] {
    pointer-events: none;
    color: transparent !important;
    background-image: linear-gradient(100deg, transparent 30%, var(--vp-e3) 50%, transparent 70%);
    background-size: 220% 100%;
    animation: vela-vp-shimmer 1.1s linear infinite;
}
html.vela-premium [data-loading='1'] * { opacity: 0; }

/* ── inputs & switches — recessed fields, crisp focus, refined track ─────── */
html.vela-premium :is(.vela-tm-input, .vela-lm-input, .vela-lm-filter,
    .vela-md-linput, .vela-ip-search, .vela-wl-search, .vela-tm-form input,
    .vela-dialog-body input[type='text'], .vela-dialog-body input[type='number']) {
    border-radius: var(--vp-r-sm);
    background: var(--vp-e0);
    border: 1px solid var(--vp-line);
    color: var(--vp-ink-hi);
    box-shadow: inset 0 1px 2px rgba(0,0,0,.22);
    transition: border-color var(--vp-t), box-shadow var(--vp-t), background var(--vp-t);
}
html.vela-premium :is(.vela-tm-input, .vela-lm-input, .vela-ip-search, .vela-wl-search):hover { border-color: var(--vp-line); }
html.vela-premium :is(.vela-tm-input, .vela-lm-input, .vela-md-linput, .vela-ip-search, .vela-wl-search):focus {
    outline: none;
    border-color: var(--vp-accent);
    box-shadow: 0 0 0 3px var(--vp-accent-wash);
}
/* Skin only the switch track, never the entire autosave row and its text. */
html.vela-premium :is(.vela-lm-pill, .vela-md-switch, .vela-lp-switch) {
    border-radius: 999px;
    background: var(--vp-e0);
    border: 1px solid var(--vp-line);
    box-shadow: inset 0 1px 2px rgba(0,0,0,.25);
    transition: background var(--vp-t), border-color var(--vp-t);
}
html.vela-premium :is(.vela-lm-pill, .vela-md-switch, .vela-lp-switch)::before,
html.vela-premium :is(.vela-lm-pill, .vela-md-switch, .vela-lp-switch)::after {
    border-radius: 999px;
    transition: transform var(--vp-t), background var(--vp-t);
}
html.vela-premium :is(.vela-panel, .vela-dialog, .vela-drawer, .vela-popover, .vela-lp, .vela-menu) .vela-switch[data-checked] {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
    color: var(--vela-selected-fg);
}
html.vela-premium :is(.vela-lm-switch[aria-checked='true'] .vela-lm-pill, .vela-md-sync[aria-checked='true'] .vela-md-switch,
    .vela-md-switchrow[aria-checked='true'] .vela-md-switch, .vela-lp-switch.on) {
    background: var(--vp-accent);
    border-color: var(--vp-accent);
}
html.vela-premium :is(.vela-lm-switch[aria-checked='true'] .vela-lm-pill, .vela-md-sync[aria-checked='true'] .vela-md-switch,
    .vela-md-switchrow[aria-checked='true'] .vela-md-switch, .vela-lp-switch.on)::after { background: var(--vela-fg-on-fill); }
html.vela-premium :is(.vela-lm-btn, .vela-lm-switch, .vela-md-lact):focus-visible { outline: none; box-shadow: var(--vp-ring); }

/* Empty states are short and useful, not a large decorative tile per empty row. */
html.vela-premium :is(.vela-tm-empty, .vela-lm-empty, .vela-ip-empty, .vela-md-empty,
    .vela-ot-empty, .vela-ot-lg-empty, .vela-ot-mo-empty, .vela-wl-empty, .vela-dw-empty) {
    display: block;
    min-height: 0;
    padding: 10px 8px;
    text-align: left;
    color: var(--vp-ink-mu);
    font-size: 12px;
    line-height: 1.4;
}

/* ── side panels (object tree / watchlist / data window) — premium header ─── */
html.vela-premium .vela-panel {
    background: var(--vp-e1);
    border: 1px solid var(--vp-line);
    border-radius: var(--vp-r-lg);
    box-shadow: var(--vp-sh-2);
}
html.vela-premium .vela-panel-header {
    padding: 3px 8px;
    border-bottom: 1px solid var(--vp-line-soft);
    min-height: 34px;
}
html.vela-premium .vela-panel-title { font-size: 10px; }
html.vela-premium .vela-panel-body { padding: 6px; }

/* ── motion: subtle, and fully disabled under reduced-motion ─────────────── */
html.vela-premium .vela-dialog[data-state='open'] { animation: vela-vp-in var(--vp-t) both; }
html.vela-premium .vela-drawer[data-state='open'] { animation: vela-vp-sheet var(--vp-t) both; }
@keyframes vela-vp-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes vela-vp-sheet { from { transform: translateY(12%); opacity: .6; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
    html.vela-premium .vela-dialog[data-state='open'],
    html.vela-premium .vela-drawer[data-state='open'],
    html.vela-premium [data-loading='1'] { animation: none; }
    html.vela-premium * { transition-duration: .01ms !important; }
}

/* Coarse pointers: keep every thumb target at 44px even after the restyle. */
@media (pointer: coarse) {
    html.vela-premium :is(.vela-tm-tab, .vela-ip-tab, .vela-md-navbtn, .vela-md-segbtn,
        .vela-dialog-btn, .vela-lm-btn, .vela-tm-chip, .vela-ip-verb) { min-height: 44px; }
}
`;

/** Opt the document into the premium surface layer. Idempotent per document.
 *  Self-contained on purpose: the single-file build minifies imported bindings to
 *  one-letter names, and an injected helper that shares a name with a workspace
 *  local can be captured before initialisation. Writing the <style> directly keeps
 *  this module dependency-free and immune to that class of bundling collision.
 *
 *  Accepts anything with an ownerDocument (an Element OR a ShadowRoot OR a Document):
 *  a floating layer is often still DETACHED when ensureUIHost runs, so its
 *  getRootNode() is the element itself — resolving to ownerDocument here keeps the
 *  one shared sheet in <head> instead of appending a copy inside every popover. */
export function installPremiumStyles(root: Document | ShadowRoot | Node | undefined = document): void {
    if (typeof document === 'undefined') return;
    const doc: Document = (root instanceof Document
        ? root
        : ((root as Node | undefined)?.ownerDocument ?? document)) as Document;
    doc.documentElement?.classList.add('vela-premium');
    const head = doc.head ?? doc.documentElement;
    if (!head || head.querySelector(`style[id="${PREMIUM_STYLE_ID}"]`)) return;
    const style = doc.createElement('style');
    style.id = PREMIUM_STYLE_ID;
    style.textContent = PREMIUM_CSS;
    head.appendChild(style);
}
