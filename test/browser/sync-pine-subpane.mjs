// Pine rendering check — the cases a real TradingView study exercises and a "plots only"
// engine used to drop on the floor:
//   1. `overlay=false` must land in its OWN pane below the price pane (TV "SUB PANE").
//   2. `hline` + `fill(hline1, hline2, color)` must paint the 70/30 wash in that pane.
//   3. `plotshape(..., offset=-lbR, location=absolute, style=shape.labelup, text=…)` must
//      paint a labelled marker AT the series value, shifted back by `offset` bars.
// The page is canvas-only (no DOM legend rows), so the check MEASURES PIXELS: the composited
// screenshot is decoded in-page and sampled for the band wash, the RSI line and the label ink.
import { open, assert, report } from './helpers.mjs';

// The study from the bug report: RSI with regular divergence labels.
const SCRIPT = `//@version=6
indicator(title="RSI divergence indicator", shorttitle="RSI divergence", format=format.price, timeframe="", timeframe_gaps=true)
len = input.int(title="RSI Period", minval=1, defval=14)
src = input(title="RSI Source", defval=close)
lbR = input(title="Pivot Lookback Right", defval=5, display = display.none)
lbL = input(title="Pivot Lookback Left", defval=5, display = display.none)
rangeUpper = input(title="Max of Lookback Range", defval=60, display = display.none)
rangeLower = input(title="Min of Lookback Range", defval=5, display = display.none)
plotBull = input(title="Plot Bullish", defval=true, display = display.none)
plotBear = input(title="Plot Bearish", defval=true, display = display.none)
bearColor = color.red
bullColor = color.green
textColor = color.white
noneColor = color.new(color.white, 100)
osc = ta.rsi(src, len)

plot(osc, title="RSI", linewidth=2, color=#2962FF)
hline(50, title="Middle Line", color=#787B86, linestyle=hline.style_dotted)
obLevel = hline(70, title="Overbought", color=#787B86, linestyle=hline.style_dotted)
osLevel = hline(30, title="Oversold", color=#787B86, linestyle=hline.style_dotted)
fill(obLevel, osLevel, title="Background", color=color.rgb(33, 150, 243, 90))

plFound = na(ta.pivotlow(osc, lbL, lbR)) ? false : true
phFound = na(ta.pivothigh(osc, lbL, lbR)) ? false : true
_inRange(cond) =>
	bars = ta.barssince(cond == true)
	rangeLower <= bars and bars <= rangeUpper

inRangePl = _inRange(plFound[1])
oscHL = osc[lbR] > ta.valuewhen(plFound, osc[lbR], 1) and inRangePl
priceLL = low[lbR] < ta.valuewhen(plFound, low[lbR], 1)
bullCondAlert = priceLL and oscHL and plFound
bullCond = plotBull and bullCondAlert

plot(plFound ? osc[lbR] : na, offset=-lbR, title="Regular Bullish", linewidth=2, color=(bullCond ? bullColor : noneColor), display = display.pane, editable = plotBull)
plotshape(bullCond ? osc[lbR] : na, offset=-lbR, title="Regular Bullish Label", text=" Bull ", style=shape.labelup, location=location.absolute, color=bullColor, textcolor=textColor, editable = plotBull)

inRangePh = _inRange(phFound[1])
oscLH = osc[lbR] < ta.valuewhen(phFound, osc[lbR], 1) and inRangePh
priceHH = high[lbR] > ta.valuewhen(phFound, high[lbR], 1)
bearCondAlert = priceHH and oscLH and phFound
bearCond = plotBear and bearCondAlert

plot(phFound ? osc[lbR] : na, offset=-lbR, title="Regular Bearish", linewidth=2, color=(bearCond ? bearColor : noneColor), display = display.pane, editable = plotBear)
plotshape(bearCond ? osc[lbR] : na, offset=-lbR, title="Regular Bearish Label", text=" Bear ", style=shape.labeldown, location=location.absolute, color=bearColor, textcolor=textColor, editable = plotBear)

alertcondition(bullCondAlert, title='Regular Bullish Divergence', message="Found a new Regular Bullish Divergence")
alertcondition(bearCondAlert, title='Regular Bearish Divergence', message='Found a new Regular Bearish Divergence')
`;

const { browser, page, errors } = await open({ settle: 2500 });

const added = await page.evaluate(async (source) => {
    const ws = window.__ws;
    const chart = ws.active.chart;
    const before = chart.indicators().length;
    try {
        chart.addIndicator(source, { title: 'RSI Divergence' });
    } catch (e) {
        return { ok: false, error: String(e) };
    }
    // Let the engine's first model land and the renderer paint a frame.
    await new Promise((r) => setTimeout(r, 2200));
    return { ok: true, before, after: chart.indicators().length };
}, SCRIPT);

assert(added.ok, 'the divergence study was added without throwing', added);
assert(added.after > added.before, 'the study mounted as an indicator', added);

// ── pixel measurement ────────────────────────────────────────────────────────────────
// Canvas-only page: decode the composited screenshot in-page (no node deps) and sample ONLY
// the active cell's rect. The band rows are the ones carrying a long horizontal run of the
// 70/30 wash; the price pane sits above them, so candle ink cannot be mistaken for a label.
const cellRect = await page.evaluate(() => {
    const r = window.__ws.active.host.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
const shot = await page.screenshot({ type: 'png' });
const b64 = shot.toString('base64');

const measured = await page.evaluate(async ({ data, rect }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data: px, width } = ctx.getImageData(0, 0, cv.width, cv.height);
    const dpr = cv.width / window.innerWidth;
    const x0 = Math.round(rect.x * dpr);
    const y0 = Math.round(rect.y * dpr);
    const x1 = Math.min(cv.width, Math.round((rect.x + rect.width) * dpr));
    const y1 = Math.min(cv.height, Math.round((rect.y + rect.height) * dpr));
    const at = (x, y) => {
        const i = (y * width + x) * 4;
        return [px[i], px[i + 1], px[i + 2]];
    };
    const near = (c, t, tol) => Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol && Math.abs(c[2] - t[2]) <= tol;
    // #2196f3 @ 10% over the plot's #151619 measures (21, 34, 47) — a faint blue-teal wash.
    const isBand = (c) => c[2] >= c[1] + 8 && c[1] >= c[0] + 8 && c[0] >= 15 && c[0] <= 40 && c[2] >= 38 && c[2] <= 80;
    // A band row: ≥ 40% of the row's width inside the shell carries the wash.
    const rowWidth = x1 - x0;
    let bandTop = -1;
    let bandBottom = -1;
    let bandRows = 0;
    let bandPixels = 0;
    for (let y = y0; y < y1; y += 1) {
        let run = 0;
        let count = 0;
        for (let x = x0; x < x1; x += 1) {
            if (isBand(at(x, y))) {
                run += 1;
                count += 1;
                if (run > 40) break;
            } else {
                run = 0;
            }
        }
        if (run > 40) {
            bandRows += 1;
            bandPixels += count;
            if (bandTop < 0) bandTop = y;
            bandBottom = y;
        }
    }
    // The RSI line + label inks, sampled inside the band's rows only (the study pane).
    const scanTop = bandTop < 0 ? y0 : Math.max(y0, bandTop - 8);
    const scanBottom = bandBottom < 0 ? y1 : Math.min(y1, bandBottom + 8);
    let line = 0;
    let green = 0;
    let red = 0;
    for (let y = scanTop; y < scanBottom; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            const c = at(x, y);
            if (near(c, [41, 98, 255], 26)) line += 1;
            if (near(c, [76, 175, 80], 26)) green += 1;
            if (near(c, [242, 54, 69], 26)) red += 1;
        }
    }
    return { dpr, cellRect: rect, bandRows, bandPixels, bandTop, bandBottom, line, green, red };
}, { data: b64, rect: cellRect });

report('pine-subpane', measured);
assert(measured.bandRows > 30, 'the hline-to-hline fill band is painted (a wide 70/30 wash)', measured);
assert(measured.line > 150, 'the RSI plot line is painted inside the study pane', measured);
// Which side fires depends on the live window's history — assert a LABEL is painted (the
// ink path, both shapes, is pinned deterministically in test/pine-markers.test.ts).
assert(measured.green + measured.red > 60, 'a divergence label is painted (label pill ink)', measured);
assert(errors.length === 0, 'no page errors', errors);

await page.screenshot({ path: 'shots/pine-subpane.png', fullPage: false });
await browser.close();
