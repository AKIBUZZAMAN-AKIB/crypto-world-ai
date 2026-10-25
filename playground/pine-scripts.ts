// Pine Script v6 scripts shipped with the playground's indicator manifest.
//
// They are ordinary Pine — the same text you would paste into any chart — executed by
// `vela-pine-libre` (registered as the `pine` engine in workspace.ts). Entries are
// `enabled: false` so they start in the Indicators picker rather than on the chart: a
// workspace that boots with every study running would be noise.
//
// `test/pine-integration.test.ts` runs these exact strings through the engine, so a
// change here that the engine cannot execute fails the build rather than the page.
import type { IndicatorManifestEntry } from "../src/widget/indicators";

const EMA_CROSS = `//@version=6
indicator("EMA Cross", overlay=true, precision=2)

fastLen = input.int(12, "Fast length", minval=1, maxval=200)
slowLen = input.int(26, "Slow length", minval=2, maxval=400)
showCross = input.bool(true, "Mark crosses")

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)

plot(fast, title="Fast EMA", color=color.orange, linewidth=2)
plot(slow, title="Slow EMA", color=color.blue, linewidth=2)

bullish = ta.crossover(fast, slow)
bearish = ta.crossunder(fast, slow)

plotshape(showCross and bullish, title="Bull", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(showCross and bearish, title="Bear", style=shape.triangledown, location=location.abovebar, color=color.red)

barcolor(bullish ? color.new(color.green, 60) : bearish ? color.new(color.red, 60) : na)
`;

const RSI_PANEL = `//@version=6
indicator("RSI", overlay=false)

len = input.int(14, "Length", minval=2)
src = input.source(close, "Source")

rsiValue = ta.rsi(src, len)

plot(rsiValue, title="RSI", color=#7e57c2, linewidth=2)
hline(70, title="Overbought", color=color.new(color.red, 40), linestyle=hline.style_dashed)
hline(30, title="Oversold", color=color.new(color.green, 40), linestyle=hline.style_dashed)
plotshape(ta.crossover(rsiValue, 30), title="Oversold exit", style=shape.circle, location=location.bottom, color=color.green, size=size.tiny)
`;

const RSI_DIVERGENCE = `//@version=6
indicator(title="RSI divergence indicator", shorttitle="RSI divergence", format=format.price, timeframe="", timeframe_gaps=true)

len = input.int(title="RSI Period", minval=1, defval=14)
src = input(title="RSI Source", defval=close)
lbR = input(title="Pivot Lookback Right", defval=5, display=display.none)
lbL = input(title="Pivot Lookback Left", defval=5, display=display.none)
rangeUpper = input(title="Max of Lookback Range", defval=60, display=display.none)
rangeLower = input(title="Min of Lookback Range", defval=5, display=display.none)
plotBull = input(title="Plot Bullish", defval=true, display=display.none)
plotBear = input(title="Plot Bearish", defval=true, display=display.none)

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

plot(plFound ? osc[lbR] : na, offset=-lbR, title="Regular Bullish", linewidth=2, color=(bullCond ? bullColor : noneColor), display=display.pane, editable=plotBull)
plotshape(bullCond ? osc[lbR] : na, offset=-lbR, title="Regular Bullish Label", text=" Bull ", style=shape.labelup, location=location.absolute, color=bullColor, textcolor=textColor, editable=plotBull)

inRangePh = _inRange(phFound[1])
oscLH = osc[lbR] < ta.valuewhen(phFound, osc[lbR], 1) and inRangePh
priceHH = high[lbR] > ta.valuewhen(phFound, high[lbR], 1)
bearCondAlert = priceHH and oscLH and phFound
bearCond = plotBear and bearCondAlert

plot(phFound ? osc[lbR] : na, offset=-lbR, title="Regular Bearish", linewidth=2, color=(bearCond ? bearColor : noneColor), display=display.pane, editable=plotBear)
plotshape(bearCond ? osc[lbR] : na, offset=-lbR, title="Regular Bearish Label", text=" Bear ", style=shape.labeldown, location=location.absolute, color=bearColor, textcolor=textColor, editable=plotBear)

alertcondition(bullCondAlert, title="Regular Bullish Divergence", message="Found a new Regular Bullish Divergence")
alertcondition(bearCondAlert, title="Regular Bearish Divergence", message="Found a new Regular Bearish Divergence")
`;

const BOLLINGER = `//@version=6
indicator("Bollinger Bands", overlay=true, precision=2)

len = input.int(20, "Length", minval=2)
mult = input.float(2.0, "StdDev", minval=0.001, step=0.1)
src = input.source(close, "Source")

basis = ta.sma(src, len)
dev = mult * ta.stdev(src, len)
upper = basis + dev
lower = basis - dev

plotUpper = plot(upper, title="Upper", color=color.new(color.blue, 0), linewidth=1)
plotLower = plot(lower, title="Lower", color=color.new(color.blue, 0), linewidth=1)
plot(basis, title="Basis", color=color.new(color.orange, 0), linewidth=2)
fill(plotUpper, plotLower, title="Band", color=color.new(color.blue, 92))
`;

const MACD = `//@version=6
indicator("MACD", overlay=false)

fastLen = input.int(12, "Fast length", minval=1)
slowLen = input.int(26, "Slow length", minval=1)
sigLen = input.int(9, "Signal smoothing", minval=1)

[macdLine, signalLine, hist] = ta.macd(close, fastLen, slowLen, sigLen)

plot(hist, title="Histogram", style=plot.style_columns, color=hist >= 0 ? color.new(color.green, 60) : color.new(color.red, 60))
plot(macdLine, title="MACD", color=color.blue, linewidth=2)
plot(signalLine, title="Signal", color=color.orange, linewidth=1)
hline(0, title="Zero", color=color.gray, linestyle=hline.style_dotted)
plotshape(ta.crossover(macdLine, signalLine), title="Cross up", style=shape.triangleup, location=location.bottom, color=color.green, size=size.tiny)
plotshape(ta.crossunder(macdLine, signalLine), title="Cross down", style=shape.triangledown, location=location.top, color=color.red, size=size.tiny)
`;

const STOCHASTIC = `//@version=6
indicator("Stochastic", overlay=false)

kLen = input.int(14, "K length", minval=1)
dLen = input.int(3, "D smoothing", minval=1)
smoothK = input.int(3, "K smoothing", minval=1)

kRaw = ta.stoch(close, high, low, kLen)
k = ta.sma(kRaw, smoothK)
d = ta.sma(k, dLen)

plot(k, title="%K", color=color.blue, linewidth=2)
plot(d, title="%D", color=color.orange, linewidth=1)
obLevel = hline(80, title="Overbought", color=color.new(color.red, 40), linestyle=hline.style_dashed)
osLevel = hline(20, title="Oversold", color=color.new(color.green, 40), linestyle=hline.style_dashed)
hline(50, title="Middle", color=color.new(color.gray, 60), linestyle=hline.style_dotted)
fill(obLevel, osLevel, title="Range", color=color.new(color.blue, 94))
plotshape(ta.crossover(k, d) and k < 20, title="Oversold cross", style=shape.circle, location=location.bottom, color=color.green, size=size.tiny)
plotshape(ta.crossunder(k, d) and k > 80, title="Overbought cross", style=shape.circle, location=location.top, color=color.red, size=size.tiny)
`;

const ATR_STUDY = `//@version=6
indicator("ATR", overlay=false)

len = input.int(14, "Length", minval=1)
smoothing = input.string("RMA", "Smoothing", options=["RMA", "SMA", "EMA", "WMA"])

atrValue = smoothing == "SMA" ? ta.sma(ta.tr, len) : smoothing == "EMA" ? ta.ema(ta.tr, len) : smoothing == "WMA" ? ta.wma(ta.tr, len) : ta.rma(ta.tr, len)

plot(atrValue, title="ATR", color=#ff9800, linewidth=2)
plot(ta.sma(atrValue, len), title="ATR average", color=color.new(color.gray, 40), linewidth=1)
hline(0, title="Zero", color=color.new(color.gray, 80))
`;

const ADX_STUDY = `//@version=6
indicator("ADX / DMI", overlay=false)

len = input.int(14, "DI length", minval=1)
smooth = input.int(14, "ADX smoothing", minval=1)

[diPlus, diMinus, adxValue] = ta.dmi(len, smooth)

plot(adxValue, title="ADX", color=color.black, linewidth=2)
plot(diPlus, title="+DI", color=color.green, linewidth=1)
plot(diMinus, title="-DI", color=color.red, linewidth=1)
hline(25, title="Trend threshold", color=color.new(color.gray, 40), linestyle=hline.style_dashed)
hline(20, title="Flat threshold", color=color.new(color.gray, 70), linestyle=hline.style_dotted)
plotshape(ta.crossover(diPlus, diMinus) and adxValue > 25, title="Bull trend", style=shape.triangleup, location=location.bottom, color=color.green, size=size.tiny)
plotshape(ta.crossunder(diPlus, diMinus) and adxValue > 25, title="Bear trend", style=shape.triangledown, location=location.top, color=color.red, size=size.tiny)
`;

const VWAP_STUDY = `//@version=6
indicator("VWAP + Bands", overlay=true, precision=2)

src = input.source(hlc3, "Source")
stdevMult = input.float(1.0, "Band StdDev", step=0.1)

vwapValue = ta.vwap(src)
dev = stdevMult * ta.stdev(src, 20)
upper = vwapValue + dev
lower = vwapValue - dev

plotUpper = plot(upper, title="Upper band", color=color.new(color.purple, 50))
plotLower = plot(lower, title="Lower band", color=color.new(color.purple, 50))
fill(plotUpper, plotLower, title="Band", color=color.new(color.purple, 94))
plot(vwapValue, title="VWAP", color=color.purple, linewidth=2)
`;

const SUPERTREND = `//@version=6
indicator("SuperTrend", overlay=true, precision=2)

factor = input.float(3.0, "Factor", step=0.1)
atrPeriod = input.int(10, "ATR length", minval=1)
showLabels = input.bool(true, "Mark flips")

[stLine, stDir] = ta.supertrend(factor, atrPeriod)

plot(stLine, title="SuperTrend", color=stDir < 0 ? color.green : color.red, linewidth=2)
plotshape(showLabels and ta.change(stDir) != 0 and stDir < 0, title="Buy flip", text="BUY", style=shape.labelup, location=location.belowbar, color=color.green, textcolor=color.white, size=size.small)
plotshape(showLabels and ta.change(stDir) != 0 and stDir > 0, title="Sell flip", text="SELL", style=shape.labeldown, location=location.abovebar, color=color.red, textcolor=color.white, size=size.small)
`;

const KELTNER = `//@version=6
indicator("Keltner Channels", overlay=true, precision=2)

len = input.int(20, "EMA length", minval=1)
mult = input.float(2.0, "ATR multiplier", step=0.1)
atrLen = input.int(10, "ATR length", minval=1)

basis = ta.ema(close, len)
[center, upper, lower] = ta.kc(close, len, mult, true, atrLen)

plotUpper = plot(upper, title="Upper", color=color.new(color.teal, 30))
plotLower = plot(lower, title="Lower", color=color.new(color.teal, 30))
plot(basis, title="Basis", color=color.new(color.orange, 0), linewidth=2)
fill(plotUpper, plotLower, title="Channel", color=color.new(color.teal, 94))
`;

const OBV_STUDY = `//@version=6
indicator("OBV", overlay=false)

showMa = input.bool(true, "Show average")
maLen = input.int(30, "Average length", minval=1)

obvValue = ta.obv
plot(obvValue, title="OBV", color=#2196f3, linewidth=2)
plot(showMa ? ta.ema(obvValue, maLen) : na, title="OBV average", color=color.new(color.orange, 0), linewidth=1)
plotshape(ta.crossover(obvValue, ta.ema(obvValue, maLen)), title="OBV cross up", style=shape.circle, location=location.bottom, color=color.green, size=size.tiny)
`;

const CCI_STUDY = `//@version=6
indicator("CCI", overlay=false)

len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")

cciValue = ta.cci(src, len)

plot(cciValue, title="CCI", color=#e91e63, linewidth=2)
hline(100, title="Overbought", color=color.new(color.red, 40), linestyle=hline.style_dashed)
hline(-100, title="Oversold", color=color.new(color.green, 40), linestyle=hline.style_dashed)
hline(0, title="Zero", color=color.new(color.gray, 60), linestyle=hline.style_dotted)
plotshape(ta.crossover(cciValue, -100), title="Exit oversold", style=shape.triangleup, location=location.bottom, color=color.green, size=size.tiny)
plotshape(ta.crossunder(cciValue, 100), title="Exit overbought", style=shape.triangledown, location=location.top, color=color.red, size=size.tiny)
`;

const WILLIAMS_R = `//@version=6
indicator("Williams %R", overlay=false)

len = input.int(14, "Length", minval=1)

wprValue = ta.wpr(len)

plot(wprValue, title="%R", color=#00bcd4, linewidth=2)
hline(-20, title="Overbought", color=color.new(color.red, 40), linestyle=hline.style_dashed)
hline(-80, title="Oversold", color=color.new(color.green, 40), linestyle=hline.style_dashed)
fill(hline(-20, title="OB"), hline(-80, title="OS"), title="Middle", color=color.new(color.blue, 96))
`;

const MFI_STUDY = `//@version=6
indicator("MFI", overlay=false)

len = input.int(14, "Length", minval=1)
src = input.source(hlc3, "Source")

mfiValue = ta.mfi(src, len)

plot(mfiValue, title="MFI", color=#8bc34a, linewidth=2)
obLevel = hline(80, title="Overbought", color=color.new(color.red, 40), linestyle=hline.style_dashed)
osLevel = hline(20, title="Oversold", color=color.new(color.green, 40), linestyle=hline.style_dashed)
fill(obLevel, osLevel, title="Band", color=color.new(color.blue, 95))
`;

const SAR_STUDY = `//@version=6
indicator("Parabolic SAR", overlay=true)

start = input.float(0.02, "Start", step=0.005)
increment = input.float(0.02, "Increment", step=0.005)
maximum = input.float(0.2, "Max value", step=0.05)

sarValue = ta.sar(start, increment, maximum)
rising = sarValue < close

plotshape(rising, title="SAR up", style=shape.circle, location=location.belowbar, color=color.green, size=size.tiny)
plotshape(not rising, title="SAR down", style=shape.circle, location=location.abovebar, color=color.red, size=size.tiny)
`;

const DONCHIAN = `//@version=6
indicator("Donchian Channels", overlay=true, precision=2)

len = input.int(20, "Channel length", minval=2)
showMid = input.bool(true, "Show midline")

upper = ta.highest(high, len)
lower = ta.lowest(low, len)
mid = (upper + lower) / 2

plotUpper = plot(upper, title="Upper", color=color.new(color.green, 0))
plotLower = plot(lower, title="Lower", color=color.new(color.red, 0))
fill(plotUpper, plotLower, title="Channel", color=color.new(color.blue, 95))
plot(showMid ? mid : na, title="Midline", color=color.new(color.gray, 30), linewidth=1)
plotshape(ta.crossover(close, upper[1]), title="Breakout", style=shape.triangleup, location=location.belowbar, color=color.green, size=size.tiny)
plotshape(ta.crossunder(close, lower[1]), title="Breakdown", style=shape.triangledown, location=location.abovebar, color=color.red, size=size.tiny)
`;

const ICHIMOKU = `//@version=6
indicator("Ichimoku", overlay=true, precision=2)

conversionLen = input.int(9, "Conversion line", minval=1)
baseLen = input.int(26, "Base line", minval=1)
spanBLen = input.int(52, "Leading span B", minval=1)
displacement = input.int(26, "Displacement", minval=0)

donchian(len) => (ta.highest(high, len) + ta.lowest(low, len)) / 2

conversion = donchian(conversionLen)
base = donchian(baseLen)
spanA = (conversion + base) / 2
spanB = donchian(spanBLen)

plotA = plot(spanA, title="Leading span A", offset=displacement, color=color.new(color.green, 40))
plotB = plot(spanB, title="Leading span B", offset=displacement, color=color.new(color.red, 40))
fill(plotA, plotB, title="Kumo", color=color.new(color.blue, 90))

plot(conversion, title="Conversion", color=color.blue, linewidth=1, offset=displacement)
plot(base, title="Base", color=color.red, linewidth=1, offset=displacement)
plot(close, title="Lagging span", color=color.new(color.gray, 0), linewidth=1, offset=-displacement)
`;

const MACD_STRATEGY = `//@version=6
strategy("MACD Strategy", overlay=true, initial_capital=100000, commission_type=strategy.commission.percent, commission_value=0.02)

[macdLine, signalLine] = ta.macd(close, 12, 26, 9)

if ta.crossover(macdLine, signalLine)
    strategy.entry("Long", strategy.long, qty=1)
    strategy.exit("Exit", from_entry="Long", profit=200, loss=100)

if ta.crossunder(macdLine, signalLine)
    strategy.close_all(comment="Signal flip")

plot(macdLine, title="MACD", color=color.blue)
plot(signalLine, title="Signal", color=color.orange)
hline(0, title="Zero", color=color.gray)
`;

const DONCHIAN_STRATEGY = `//@version=6
strategy("Donchian Breakout", overlay=true, initial_capital=100000, commission_value=0)

len = input.int(20, "Channel length", minval=2)

upper = ta.highest(high, len)[1]
lower = ta.lowest(low, len)[1]

if ta.crossover(close, upper)
    strategy.entry("Long", strategy.long, qty=1)
    strategy.exit("Stop", from_entry="Long", loss=150, profit=400)

if ta.crossunder(close, lower)
    strategy.close("Long", comment="Channel exit")

plot(upper, title="Upper", color=color.new(color.green, 0))
plot(lower, title="Lower", color=color.new(color.red, 0))
`;

export const PINE_SCRIPTS: IndicatorManifestEntry[] = [
    { name: "Pine · EMA Cross", script: EMA_CROSS, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · RSI", script: RSI_PANEL, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · RSI Divergence", script: RSI_DIVERGENCE, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · MACD", script: MACD, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Bollinger Bands", script: BOLLINGER, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Keltner Channels", script: KELTNER, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Donchian Channels", script: DONCHIAN, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · VWAP + Bands", script: VWAP_STUDY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · SuperTrend", script: SUPERTREND, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Ichimoku", script: ICHIMOKU, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Parabolic SAR", script: SAR_STUDY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Stochastic", script: STOCHASTIC, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · ADX / DMI", script: ADX_STUDY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · ATR", script: ATR_STUDY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · CCI", script: CCI_STUDY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Williams %R", script: WILLIAMS_R, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · MFI", script: MFI_STUDY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · OBV", script: OBV_STUDY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · MACD Strategy", script: MACD_STRATEGY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Donchian Breakout", script: DONCHIAN_STRATEGY, language: "pine", enabled: false, category: "Pine Script" },
];
