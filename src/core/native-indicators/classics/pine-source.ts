/**
 * The Pine Script™ source of the built-in (native) indicators.
 *
 * TradingView's built-ins ARE Pine scripts: the study's legend carries a `{ }` "Source code"
 * icon, and clicking it opens the script in the Pine Editor (read-only, with a "create a
 * working copy" banner). A few built-ins are not written in Pine (Volume Profile, chart
 * patterns) and therefore show no icon at all.
 *
 * This module is that mapping for Vela's classic catalog: `classicPineSource(type)` returns
 * the v6 script behind a study, or `undefined` when the study has no Pine implementation —
 * which is exactly the condition the legend's "Source code" action tests.
 *
 * The scripts are not decoration: `test/classic-pine.test.ts` executes every one of them
 * through the vendored engine and compares its plots against the native compute, so a study
 * whose Pine equivalent drifts from the native numbers fails the build.
 */

import { ACCENT, BEARISH, BULLISH, NEUTRAL, WARNING } from '../../palette';
import { classicSpecs } from './index';

/** The classic catalog's study-line blue — the colour every default plot uses. */
const LINE_BLUE = '#2196f3'; // palette-exempt: the classic studies' historical line colour

/**
 * A script's header. The `shorttitle` is the studys's compact legend name, taken from the
 * catalog so a built-in's legend reads exactly like the native row it replaces ("SMA", not
 * "Simple Moving Average") — TradingView's own built-ins declare it the same way.
 */
const script = (title: string, overlay: boolean, body: string): string => {
    const short = classicSpecs.find((spec) => spec.title === title)?.shortTitle;
    const header = short && short !== title ? `indicator("${title}", shorttitle="${short}", overlay=${overlay})` : `indicator("${title}", overlay=${overlay})`;
    return `//@version=6\n${header}\n\n${body.trim()}\n`;
};

/** Source-select expression shared by the studies that expose a price source input. */
const SOURCE_INPUT = `src = input.source(close, "Source")`;

const SMA = script(
    'Simple Moving Average',
    true,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
offset = input.int(0, "Offset", minval=-500, maxval=500)
ink = input.color(${LINE_BLUE}, "Color")

plot(ta.sma(src, len), title="SMA", color=ink, linewidth=2, offset=offset)`,
);

const EMA = script(
    'Exponential Moving Average',
    true,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
offset = input.int(0, "Offset", minval=-500, maxval=500)
ink = input.color(${LINE_BLUE}, "Color")

plot(ta.ema(src, len), title="EMA", color=ink, linewidth=2, offset=offset)`,
);

const RMA = script(
    'Smoothed Moving Average',
    true,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
offset = input.int(0, "Offset", minval=-500, maxval=500)
ink = input.color(${LINE_BLUE}, "Color")

plot(ta.rma(src, len), title="RMA", color=ink, linewidth=2, offset=offset)`,
);

const ZLEMA = script(
    'Zero-Lag EMA',
    true,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "Color")

lag = math.floor((len - 1) / 2)
zeroLag = src + (src - src[lag])
plot(ta.ema(zeroLag, len), title="ZLEMA", color=ink, linewidth=2)`,
);

const MOVING_AVERAGE = script(
    'Moving Average',
    true,
    `${SOURCE_INPUT}
maType = input.string("SMA", "MA 1 Type", options=["SMA", "EMA", "WMA", "RMA (SMMA)", "HMA", "VWMA", "DEMA", "TEMA", "ZLEMA"])
len = input.int(20, "MA 1 Length", minval=1)
showMa2 = input.bool(false, "Show MA 2")
ma2Len = input.int(50, "MA 2 Length", minval=1)
ink = input.color(${LINE_BLUE}, "MA 1")
ink2 = input.color(${WARNING}, "MA 2")

average(kind, source, length) =>
    ema1 = ta.ema(source, length)
    ema2 = ta.ema(ema1, length)
    ema3 = ta.ema(ema2, length)
    zeroLag = source + (source - source[math.floor((length - 1) / 2)])
    kind == "EMA" ? ema1 : kind == "WMA" ? ta.wma(source, length) : kind == "RMA (SMMA)" ? ta.rma(source, length) : kind == "HMA" ? ta.hma(source, length) : kind == "VWMA" ? ta.vwma(source, length) : kind == "DEMA" ? 2 * ema1 - ema2 : kind == "TEMA" ? 3 * ema1 - 3 * ema2 + ema3 : kind == "ZLEMA" ? ta.ema(zeroLag, length) : ta.sma(source, length)

plot(average(maType, src, len), title="MA 1", color=ink, linewidth=2)
plot(showMa2 ? average(maType, src, ma2Len) : na, title="MA 2", color=ink2, linewidth=1)`,
);

const MA_ENVELOPE = script(
    'MA Envelope',
    true,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
percent = input.float(2.5, "Percent", minval=0.1, step=0.1)
ink = input.color(${LINE_BLUE}, "Basis")
bandInk = input.color(${NEUTRAL}, "Envelope")

basis = ta.sma(src, len)
upper = basis * (1 + percent / 100)
lower = basis * (1 - percent / 100)

plotUpper = plot(upper, title="Upper", color=bandInk)
plotLower = plot(lower, title="Lower", color=bandInk)
plot(basis, title="Basis", color=ink, linewidth=2)
fill(plotUpper, plotLower, color=color.new(bandInk, 92))`,
);

const LINEAR_REGRESSION = script(
    'Linear Regression Curve',
    false,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
offset = input.int(0, "Offset", minval=0, maxval=500)
ink = input.color(${LINE_BLUE}, "Line")

plot(ta.linreg(src, len, offset), title="Linear regression", color=ink, linewidth=2, force_overlay=true)`,
);

const BOLLINGER = script(
    'Bollinger Bands',
    true,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "Multiplier", minval=0.1, step=0.1)
basisInk = input.color(${WARNING}, "Basis")
bandInk = input.color(${LINE_BLUE}, "Bands")
fillInk = input.color(color.new(${LINE_BLUE}, 92), "Fill")

basis = ta.sma(src, len)
dev = mult * ta.stdev(src, len)
upper = basis + dev
lower = basis - dev

pUpper = plot(upper, title="Upper", color=bandInk)
pLower = plot(lower, title="Lower", color=bandInk)
plot(basis, title="Basis", color=basisInk, linewidth=2)
fill(pUpper, pLower, title="Bands fill", color=fillInk)`,
);

const KELTNER = script(
    'Keltner Channels',
    true,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "Multiplier", minval=0.1, step=0.1)
atrLen = input.int(10, "ATR Length", minval=1)
basisInk = input.color(${WARNING}, "Basis")
bandInk = input.color(${LINE_BLUE}, "Bands")

basis = ta.ema(src, len)
range = mult * ta.atr(atrLen)
upper = basis + range
lower = basis - range

pUpper = plot(upper, title="Upper", color=bandInk)
pLower = plot(lower, title="Lower", color=bandInk)
plot(basis, title="Basis", color=basisInk, linewidth=2)
fill(pUpper, pLower, color=color.new(bandInk, 92))`,
);

const DONCHIAN = script(
    'Donchian Channels',
    true,
    `len = input.int(20, "Length", minval=1)
offset = input.int(0, "Offset", minval=-500, maxval=500)
ink = input.color(${LINE_BLUE}, "Channels")

upper = ta.highest(high, len)
lower = ta.lowest(low, len)
mid = (upper + lower) / 2

pUpper = plot(upper, title="Upper", color=ink, offset=offset)
pLower = plot(lower, title="Lower", color=ink, offset=offset)
plot(mid, title="Basis", color=color.new(ink, 40), offset=offset)
fill(pUpper, pLower, color=color.new(ink, 92))`,
);

const SUPERTREND = script(
    'SuperTrend',
    true,
    `factor = input.float(3.0, "Factor", minval=0.1, step=0.1)
atrPeriod = input.int(10, "ATR Length", minval=1)
upInk = input.color(${BULLISH}, "Up")
downInk = input.color(${BEARISH}, "Down")

[stLine, stDir] = ta.supertrend(factor, atrPeriod)

plot(stLine, title="SuperTrend", color=stDir < 0 ? upInk : downInk, linewidth=2)`,
);

const SAR = script(
    'Parabolic SAR',
    true,
    `start = input.float(0.02, "Start", step=0.001)
increment = input.float(0.02, "Increment", step=0.001)
maximum = input.float(0.2, "Maximum", step=0.01)
ink = input.color(${LINE_BLUE}, "SAR")

plot(ta.sar(start, increment, maximum), title="SAR", style=plot.style_circles, color=ink)`,
);

const VWAP = script(
    'VWAP',
    true,
    `src = input.source(hlc3, "Source")
stdevMult = input.float(1.0, "Bands Multiplier", minval=0, step=0.1)
ink = input.color(${LINE_BLUE}, "VWAP")
bandInk = input.color(${NEUTRAL}, "Bands")

vwapValue = ta.vwap(src)
dev = stdevMult * ta.stdev(src, 20)

pUpper = plot(vwapValue + dev, title="Upper band", color=bandInk)
pLower = plot(vwapValue - dev, title="Lower band", color=bandInk)
plot(vwapValue, title="VWAP", color=ink, linewidth=2)
fill(pUpper, pLower, color=color.new(bandInk, 92))`,
);

const RSI = script(
    'Relative Strength Index',
    false,
    `${SOURCE_INPUT}
len = input.int(14, "Length", minval=1)
overbought = input.float(70, "Overbought", minval=0, maxval=100)
oversold = input.float(30, "Oversold", minval=0, maxval=100)
ink = input.color(${NEUTRAL}, "RSI")
obInk = input.color(${BEARISH}, "Overbought")
osInk = input.color(${BULLISH}, "Oversold")
levelInk = input.color(${NEUTRAL}, "Levels")
fillInk = input.color(color.new(${NEUTRAL}, 90), "Band fill")

rsiValue = ta.rsi(src, len)

plot(rsiValue, title="RSI", color=ink, linewidth=2)
obLevel = hline(overbought, title="Overbought", color=levelInk, linestyle=hline.style_dashed)
osLevel = hline(oversold, title="Oversold", color=levelInk, linestyle=hline.style_dashed)
hline(50, title="Middle", color=levelInk, linestyle=hline.style_dotted)
fill(obLevel, osLevel, title="Background", color=fillInk)`,
);

const STOCHASTIC = script(
    'Stochastic',
    false,
    `kLength = input.int(14, "%K Length", minval=1)
kSmoothing = input.int(3, "%K Smoothing", minval=1)
dLength = input.int(3, "%D Smoothing", minval=1)
overbought = input.float(80, "Overbought", minval=0, maxval=100)
oversold = input.float(20, "Oversold", minval=0, maxval=100)
kInk = input.color(${LINE_BLUE}, "%K")
dInk = input.color(${WARNING}, "%D")

k = ta.sma(ta.stoch(close, high, low, kLength), kSmoothing)
d = ta.sma(k, dLength)

plot(k, title="%K", color=kInk, linewidth=2)
plot(d, title="%D", color=dInk)
obLevel = hline(overbought, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
osLevel = hline(oversold, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
fill(obLevel, osLevel, title="Background", color=color.new(${LINE_BLUE}, 90))`,
);

const STOCHASTIC_RSI = script(
    'Stochastic RSI',
    false,
    `${SOURCE_INPUT}
rsiLen = input.int(14, "RSI Length", minval=1)
stochLen = input.int(14, "Stochastic Length", minval=1)
kLen = input.int(3, "%K Smoothing", minval=1)
dLen = input.int(3, "%D Smoothing", minval=1)
kInk = input.color(${LINE_BLUE}, "%K")
dInk = input.color(${WARNING}, "%D")

rsiValue = ta.rsi(src, rsiLen)
k = ta.sma(ta.stoch(rsiValue, rsiValue, rsiValue, stochLen), kLen)
d = ta.sma(k, dLen)

plot(k, title="%K", color=kInk, linewidth=2)
plot(d, title="%D", color=dInk)
obLevel = hline(80, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
osLevel = hline(20, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
fill(obLevel, osLevel, color=color.new(${LINE_BLUE}, 90))`,
);

const MACD = script(
    'MACD',
    false,
    `${SOURCE_INPUT}
fastLength = input.int(12, "Fast Length", minval=1)
slowLength = input.int(26, "Slow Length", minval=1)
signalLength = input.int(9, "Signal Smoothing", minval=1)
lineInk = input.color(${LINE_BLUE}, "MACD Line")
signalInk = input.color(${WARNING}, "Signal Line")

line = ta.ema(src, fastLength) - ta.ema(src, slowLength)
signal = ta.ema(line, signalLength)
hist = line - signal

plot(hist, title="Histogram", style=plot.style_columns, color=hist >= 0 ? color.new(${BULLISH}, hist >= hist[1] ? 0 : 50) : color.new(${BEARISH}, hist >= hist[1] ? 50 : 0))
plot(line, title="MACD", color=lineInk, linewidth=2)
plot(signal, title="Signal", color=signalInk)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const PPO = script(
    'Percentage Price Oscillator',
    false,
    `${SOURCE_INPUT}
fastLength = input.int(12, "Fast Length", minval=1)
slowLength = input.int(26, "Slow Length", minval=1)
signalLength = input.int(9, "Signal Smoothing", minval=1)
lineInk = input.color(${LINE_BLUE}, "PPO Line")
signalInk = input.color(${WARNING}, "Signal Line")

fast = ta.ema(src, fastLength)
slow = ta.ema(src, slowLength)
line = 100 * (fast - slow) / slow
signal = ta.ema(line, signalLength)

plot(line - signal, title="Histogram", style=plot.style_columns, color=line - signal >= 0 ? ${BULLISH} : ${BEARISH})
plot(line, title="PPO", color=lineInk, linewidth=2)
plot(signal, title="Signal", color=signalInk)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const WILLIAMS_R = script(
    'Williams %R',
    false,
    `len = input.int(14, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "%R")

plot(ta.wpr(len), title="%R", color=ink, linewidth=2)
obLevel = hline(-20, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
osLevel = hline(-80, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
fill(obLevel, osLevel, title="Background", color=color.new(${LINE_BLUE}, 90))`,
);

const CCI = script(
    'Commodity Channel Index',
    false,
    `src = input.source(hlc3, "Source")
len = input.int(20, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "CCI")

cciValue = ta.cci(src, len)

plot(cciValue, title="CCI", color=ink, linewidth=2)
hline(100, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
hline(-100, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
hline(0, title="Zero", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const AO = script(
    'Awesome Oscillator',
    false,
    `fastLength = input.int(5, "Fast Length", minval=1)
slowLength = input.int(34, "Slow Length", minval=1)

ao = ta.sma(hl2, fastLength) - ta.sma(hl2, slowLength)

plot(ao, title="AO", style=plot.style_columns, color=ao >= 0 ? (ao >= ao[1] ? ${BULLISH} : color.new(${BULLISH}, 50)) : (ao < ao[1] ? ${BEARISH} : color.new(${BEARISH}, 50)))
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50))`,
);

const ROC = script(
    'Rate of Change',
    false,
    `${SOURCE_INPUT}
len = input.int(9, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "ROC")

plot(ta.roc(src, len), title="ROC", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const TRIX = script(
    'TRIX',
    false,
    `${SOURCE_INPUT}
len = input.int(18, "Length", minval=1)
signalLength = input.int(9, "Signal Length", minval=1)
ink = input.color(${LINE_BLUE}, "TRIX")
signalInk = input.color(${WARNING}, "Signal")

ema1 = ta.ema(src, len)
ema2 = ta.ema(ema1, len)
ema3 = ta.ema(ema2, len)
trix = 100 * ta.change(ema3) / ema3

plot(trix, title="TRIX", color=ink, linewidth=2)
plot(ta.ema(trix, signalLength), title="Signal", color=signalInk)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const TSI = script(
    'True Strength Index',
    false,
    `${SOURCE_INPUT}
longLen = input.int(25, "Long Length", minval=1)
shortLen = input.int(13, "Short Length", minval=1)
signalLen = input.int(13, "Signal Length", minval=1)
ink = input.color(${LINE_BLUE}, "TSI")
signalInk = input.color(${WARNING}, "Signal")

momentum = ta.change(src)
smoothed = ta.ema(ta.ema(momentum, longLen), shortLen)
absolute = ta.ema(ta.ema(math.abs(momentum), longLen), shortLen)
tsi = 100 * smoothed / absolute

plot(tsi, title="TSI", color=ink, linewidth=2)
plot(ta.ema(tsi, signalLen), title="Signal", color=signalInk)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const MFI = script(
    'Money Flow Index',
    false,
    `len = input.int(14, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "MFI")

mfiValue = ta.mfi(hlc3, len, volume)

plot(mfiValue, title="MFI", color=ink, linewidth=2)
obLevel = hline(80, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
osLevel = hline(20, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
fill(obLevel, osLevel, title="Background", color=color.new(${LINE_BLUE}, 90))`,
);

const OBV = script(
    'On Balance Volume',
    false,
    `showAverage = input.bool(true, "Show average")
averageLen = input.int(30, "Average Length", minval=1)
ink = input.color(${LINE_BLUE}, "OBV")

obvValue = ta.obv

plot(obvValue, title="OBV", color=ink, linewidth=2)
plot(showAverage ? ta.ema(obvValue, averageLen) : na, title="OBV average", color=color.new(${WARNING}, 0))`,
);

const ADL = script(
    'Accumulation/Distribution',
    false,
    `ink = input.color(${LINE_BLUE}, "A/D")

plot(ta.accdist, title="A/D", color=ink, linewidth=2)`,
);

const CMF = script(
    'Chaikin Money Flow',
    false,
    `len = input.int(20, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "CMF")

moneyFlowVolume = ((close - low) - (high - close)) / (high - low) * volume
plot(ta.sma(moneyFlowVolume, len) / ta.sma(volume, len), title="CMF", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const EOM = script(
    'Ease of Movement',
    false,
    `len = input.int(14, "Length", minval=1)
divisor = input.float(10000, "Divisor", minval=1)
ink = input.color(${LINE_BLUE}, "EOM")

distance = hl2 - hl2[1]
boxRatio = volume / divisor / (high - low)
eom = ta.sma(distance / boxRatio, len)

plot(eom, title="EOM", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const FORCE_INDEX = script(
    'Force Index',
    false,
    `len = input.int(13, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "Force")

force = (close - close[1]) * volume

plot(ta.ema(force, len), title="Force", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const BOP = script(
    'Balance of Power',
    false,
    `smoothing = input.int(14, "Smoothing", minval=1)
ink = input.color(${LINE_BLUE}, "BOP")

plot(ta.sma((close - open) / (high - low), smoothing), title="BOP", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const ATR = script(
    'Average True Range',
    false,
    `len = input.int(14, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "ATR")

plot(ta.rma(ta.tr, len), title="ATR", color=ink, linewidth=2)`,
);

const ADX = script(
    'Average Directional Index',
    false,
    `len = input.int(14, "DI Length", minval=1)
smooth = input.int(14, "ADX Smoothing", minval=1)
adxInk = input.color(${LINE_BLUE}, "ADX")
diPlusInk = input.color(${BULLISH}, "+DI")
diMinusInk = input.color(${BEARISH}, "-DI")

[diPlus, diMinus, adxValue] = ta.dmi(len, smooth)

plot(adxValue, title="ADX", color=adxInk, linewidth=2)
plot(diPlus, title="+DI", color=diPlusInk)
plot(diMinus, title="-DI", color=diMinusInk)
hline(25, title="Trend threshold", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const AROON = script(
    'Aroon',
    false,
    `len = input.int(14, "Length", minval=1)
upInk = input.color(${BULLISH}, "Aroon Up")
downInk = input.color(${BEARISH}, "Aroon Down")

highestBars = ta.highestbars(high, len + 1)
lowestBars = ta.lowestbars(low, len + 1)
up = 100 * (len - math.abs(highestBars)) / len
down = 100 * (len - math.abs(lowestBars)) / len

plot(up, title="Aroon Up", color=upInk, linewidth=2)
plot(down, title="Aroon Down", color=downInk, linewidth=2)
hline(70, title="Overbought", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)
hline(30, title="Oversold", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const VORTEX = script(
    'Vortex Indicator',
    false,
    `len = input.int(14, "Length", minval=1)
plusInk = input.color(${BULLISH}, "VI+")
minusInk = input.color(${BEARISH}, "VI-")

vmPlus = math.sum(math.abs(high - low[1]), len)
vmMinus = math.sum(math.abs(low - high[1]), len)
trSum = math.sum(ta.tr, len)
viPlus = vmPlus / trSum
viMinus = vmMinus / trSum

plot(viPlus, title="VI+", color=plusInk, linewidth=2)
plot(viMinus, title="VI-", color=minusInk, linewidth=2)
hline(1, title="Crossing level", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const ULTIMATE = script(
    'Ultimate Oscillator',
    false,
    `len1 = input.int(7, "Fast length", minval=1)
len2 = input.int(14, "Middle length", minval=1)
len3 = input.int(28, "Slow length", minval=1)
ink = input.color(${LINE_BLUE}, "UO")

buyingPressure = close - math.min(low, close[1])
trueRange = math.max(high, close[1]) - math.min(low, close[1])

average(l) =>
    math.sum(buyingPressure, l) / math.sum(trueRange, l)

uo = 100 * (4 * average(len1) + 2 * average(len2) + average(len3)) / 7

plot(uo, title="Ultimate", color=ink, linewidth=2)
hline(70, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
hline(30, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)`,
);

const CHOPPINESS = script(
    'Choppiness Index',
    false,
    `len = input.int(14, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "Choppiness")

atrSum = math.sum(ta.tr, len)
rangeSpan = ta.highest(high, len) - ta.lowest(low, len)
chop = 100 * math.log10(atrSum / rangeSpan) / math.log10(len)

plot(chop, title="Choppiness", color=ink, linewidth=2)
hline(61.8, title="Choppy", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)
hline(38.2, title="Trending", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const MASS_INDEX = script(
    'Mass Index',
    false,
    `length = input.int(9, "Length", minval=1)
emaLength = input.int(9, "EMA Length", minval=1)
ink = input.color(${LINE_BLUE}, "Mass Index")

span = high - low
singleEma = ta.ema(span, length)
doubleEma = ta.ema(singleEma, emaLength)
ratio = singleEma / doubleEma
mass = math.sum(ratio, 25)

plot(mass, title="Mass Index", color=ink, linewidth=2)
hline(27, title="Bulge", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)
hline(26.5, title="Bulge", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const STD_DEV = script(
    'Standard Deviation',
    false,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "StdDev")

plot(ta.stdev(src, len), title="StdDev", color=ink, linewidth=2)`,
);

const HIST_VOL = script(
    'Historical Volatility',
    false,
    `len = input.int(30, "Length", minval=2)
annual = input.int(365, "Annualization", minval=1)
ink = input.color(${LINE_BLUE}, "Volatility")

returns = math.log(close / close[1])
volatility = 100 * ta.stdev(returns, len) * math.sqrt(annual)

plot(volatility, title="Volatility", color=ink, linewidth=2)`,
);

const PERCENT_B = script(
    'Bollinger %B',
    false,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "Multiplier", minval=0.1, step=0.1)
ink = input.color(${LINE_BLUE}, "%B")

basis = ta.sma(src, len)
dev = mult * ta.stdev(src, len)
percentB = (src - (basis - dev)) / (2 * dev)

plot(percentB, title="%B", color=ink, linewidth=2)
hline(1, title="Upper band", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)
hline(0, title="Lower band", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const BANDWIDTH = script(
    'Bollinger Bands Width',
    false,
    `${SOURCE_INPUT}
len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "Multiplier", minval=0.1, step=0.1)
ink = input.color(${LINE_BLUE}, "Bandwidth")

basis = ta.sma(src, len)
dev = mult * ta.stdev(src, len)
bandwidth = 100 * (2 * dev) / basis

plot(bandwidth, title="Bandwidth", color=ink, linewidth=2)`,
);

const COPPOCK = script(
    'Coppock Curve',
    false,
    `wmaLength = input.int(10, "WMA Length", minval=1)
longROC = input.int(14, "Long ROC", minval=1)
shortROC = input.int(11, "Short ROC", minval=1)
ink = input.color(${LINE_BLUE}, "Coppock")

plot(ta.wma(ta.roc(close, longROC) + ta.roc(close, shortROC), wmaLength), title="Coppock", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const DPO = script(
    'Detrended Price Oscillator',
    false,
    `${SOURCE_INPUT}
len = input.int(21, "Length", minval=2)
centered = input.bool(false, "Centered")
ink = input.color(${LINE_BLUE}, "DPO")

offset = math.floor(len / 2) + 1
dpo = src - ta.sma(src, len)[offset]

plot(dpo, title="DPO", color=ink, linewidth=2, offset=centered ? offset : 0)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const FISHER = script(
    'Fisher Transform',
    false,
    `len = input.int(9, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "Fisher")
signalInk = input.color(${WARNING}, "Trigger")

highestValue = ta.highest(hl2, len)
lowestValue = ta.lowest(hl2, len)
raw = 2 * ((hl2 - lowestValue) / (highestValue - lowestValue) - 0.5)

var float value = 0.0
var float fisher = 0.0
value := 0.66 * raw + 0.67 * nz(value[1])
clamped = math.max(math.min(value, 0.999), -0.999)
fisher := 0.5 * math.log((1 + clamped) / (1 - clamped)) + 0.5 * nz(fisher[1])

plot(fisher, title="Fisher", color=ink, linewidth=2)
plot(fisher[1], title="Trigger", color=signalInk)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const RVI = script(
    'Relative Vigor Index',
    false,
    `len = input.int(10, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "RVI")
signalInk = input.color(${WARNING}, "Signal")

numerator = (close - open + 2 * (close[1] - open[1]) + 2 * (close[2] - open[2]) + (close[3] - open[3])) / 6
denominator = (high - low + 2 * (high[1] - low[1]) + 2 * (high[2] - low[2]) + (high[3] - low[3])) / 6
rvi = ta.sma(numerator, len) / ta.sma(denominator, len)
trigger = (rvi + 2 * rvi[1] + 2 * rvi[2] + rvi[3]) / 6

plot(rvi, title="RVI", color=ink, linewidth=2)
plot(trigger, title="Signal", color=signalInk)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const ULCER = script(
    'Ulcer Index',
    false,
    `len = input.int(14, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "Ulcer")

highestClose = ta.highest(close, len)
drawdown = 100 * (close - highestClose) / highestClose
ulcer = math.sqrt(ta.sma(drawdown * drawdown, len))

plot(ulcer, title="Ulcer", color=ink, linewidth=2)`,
);

const CHAIKIN_OSC = script(
    'Chaikin Oscillator',
    false,
    `fastLength = input.int(3, "Fast Length", minval=1)
slowLength = input.int(10, "Slow Length", minval=1)
ink = input.color(${LINE_BLUE}, "Chaikin")

plot(ta.ema(ta.accdist, fastLength) - ta.ema(ta.accdist, slowLength), title="Chaikin", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const CHANDE_MOM = script(
    'Chande Momentum Oscillator',
    false,
    `${SOURCE_INPUT}
len = input.int(14, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "CMO")

plot(ta.cmo(src, len), title="CMO", color=ink, linewidth=2)
hline(50, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
hline(-50, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
hline(0, title="Zero", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const VOLUME_OSC = script(
    'Volume Oscillator',
    false,
    `fastLength = input.int(5, "Fast Length", minval=1)
slowLength = input.int(10, "Slow Length", minval=1)
ink = input.color(${LINE_BLUE}, "Volume Oscillator")

fast = ta.ema(volume, fastLength)
slow = ta.ema(volume, slowLength)

plot(100 * (fast - slow) / slow, title="Volume Oscillator", color=ink, linewidth=2)
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

const PVT = script(
    'Price Volume Trend',
    false,
    `ink = input.color(${LINE_BLUE}, "PVT")

plot(ta.pvt, title="PVT", color=ink, linewidth=2)`,
);

const NVI = script(
    'Negative Volume Index',
    false,
    `ink = input.color(${LINE_BLUE}, "NVI")

plot(ta.nvi, title="NVI", color=ink, linewidth=2)`,
);

const PVI = script(
    'Positive Volume Index',
    false,
    `ink = input.color(${LINE_BLUE}, "PVI")

plot(ta.pvi, title="PVI", color=ink, linewidth=2)`,
);

const ELDER_RAY = script(
    'Elder Ray',
    false,
    `len = input.int(13, "Length", minval=1)
bullInk = input.color(${BULLISH}, "Bull Power")
bearInk = input.color(${BEARISH}, "Bear Power")

basis = ta.ema(close, len)

plot(high - basis, title="Bull Power", style=plot.style_columns, color=color.new(bullInk, 50))
plot(low - basis, title="Bear Power", style=plot.style_columns, color=color.new(bearInk, 50))
plot(basis - basis, title="Zero", color=color.new(${NEUTRAL}, 100))`,
);

const PIVOT_POINTS = script(
    'Pivot Points Standard',
    true,
    `mode = input.string("Traditional", "Type", options=["Traditional", "Fibonacci", "Woodie", "Classic", "DM", "Camarilla"])
ink = input.color(${LINE_BLUE}, "Pivots")

levels = ta.pivot_point_levels(mode == "Traditional" ? "traditional" : mode == "Fibonacci" ? "fibonacci" : mode == "Woodie" ? "woodie" : mode == "Camarilla" ? "camarilla" : mode == "DM" ? "dm" : "classic", close)

p = plot(array.get(levels, 0), title="P", color=ink, linewidth=2)
plot(array.get(levels, 1), title="R1", color=color.new(${BEARISH}, 30))
plot(array.get(levels, 2), title="R2", color=color.new(${BEARISH}, 50))
plot(array.get(levels, 3), title="R3", color=color.new(${BEARISH}, 70))
plot(array.get(levels, 4), title="S1", color=color.new(${BULLISH}, 30))
plot(array.get(levels, 5), title="S2", color=color.new(${BULLISH}, 50))
plot(array.get(levels, 6), title="S3", color=color.new(${BULLISH}, 70))`,
);

const W52 = script(
    '52 Week High/Low',
    true,
    `len = input.int(252, "Bars per year", minval=1)
highInk = input.color(${BULLISH}, "High")
lowInk = input.color(${BEARISH}, "Low")

weekHigh = ta.highest(high, len)
weekLow = ta.lowest(low, len)
mid = (weekHigh + weekLow) / 2

pHigh = plot(weekHigh, title="52W High", color=highInk, linewidth=2)
pLow = plot(weekLow, title="52W Low", color=lowInk, linewidth=2)
plot(mid, title="52W Mid", color=color.new(${NEUTRAL}, 40))
fill(pHigh, pLow, title="Range", color=color.new(${NEUTRAL}, 95))`,
);

const SCHAFF = script(
    'Schaff Trend Cycle',
    false,
    `fastLength = input.int(23, "MACD Fast", minval=1)
slowLength = input.int(50, "MACD Slow", minval=1)
cycleLength = input.int(10, "Cycle Length", minval=1)
ink = input.color(${LINE_BLUE}, "STC")

macd = ta.ema(close, fastLength) - ta.ema(close, slowLength)
k = ta.stoch(macd, macd, macd, cycleLength)
d = ta.ema(k, cycleLength)
stc = ta.ema(d, cycleLength)

plot(stc, title="STC", color=ink, linewidth=2)
hline(25, title="Oversold", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)
hline(75, title="Overbought", color=color.new(${NEUTRAL}, 0), linestyle=hline.style_dashed)`,
);

const INTENSITY = script(
    'Intraday Intensity',
    false,
    `ink = input.color(${LINE_BLUE}, "Intraday Intensity")

plot(ta.iii, title="Intraday Intensity", color=ink, linewidth=2)`,
);

const VIDYA_MARGIN = script(
    'VIDYA',
    true,
    `${SOURCE_INPUT}
len = input.int(14, "Length", minval=1)
ink = input.color(${LINE_BLUE}, "VIDYA")

alpha = 2 / (len + 1)
change_ = math.abs(src - src[len])
volatility_ = math.sum(math.abs(src - src[1]), len)
vi = change_ / volatility_
vidya = 0.0
vidya := alpha * vi * src + (1 - alpha * vi) * nz(vidya[1], src)

plot(vidya, title="VIDYA", color=ink, linewidth=2)`,
);

const VOLUME_FLOW = script(
    'Volume Flow Indicator',
    false,
    `len = input.int(130, "Length", minval=1)
coef = input.float(0.2, "Coefficient", step=0.01)
cutoff = input.float(0.5, "Cutoff", step=0.1)
ink = input.color(${LINE_BLUE}, "VFI")

typical = hlc3
inter = math.log(typical) - math.log(typical[1])
vinter = ta.stdev(inter, 30)
cutoffValue = cutoff * vinter * close
vmax = volume
value = typical - typical[1]
vcp = value > cutoffValue ? vmax : value < -cutoffValue ? -vmax : 0
vfi = math.sum(vcp, len) / math.sum(vmax, len) * coef * close

plot(vfi, title="VFI", color=ink, linewidth=2)
plot(ta.ema(vfi, 3), title="VFI EMA", color=color.new(${WARNING}, 0))
hline(0, title="Zero line", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dotted)`,
);

/** Type → Pine v6 source. A type absent here has no Pine implementation (no `{ }` icon). */
// ── the last group: studies whose Pine form arrived with full coverage ──────────────

const CHANDELIER_EXIT = script(
    'Chandelier Exit',
    true,
    `len = input.int(22, "Length", minval=1)
mult = input.float(3.0, "Multiplier", minval=0.1, step=0.1)
ratchet = input.bool(false, "Use ratchet")
longInk = input.color(${BULLISH}, "Long", inline="c")
shortInk = input.color(${BEARISH}, "Short", inline="c")

rangeAt = ta.atr(len) * mult
basicLong = ta.highest(high, len) - rangeAt
basicShort = ta.lowest(low, len) + rangeAt

var float longStop = na
var float shortStop = na
longStop := ratchet and not na(longStop) and close[1] > longStop ? math.max(basicLong, longStop) : basicLong
shortStop := ratchet and not na(shortStop) and close[1] < shortStop ? math.min(basicShort, shortStop) : basicShort

plot(longStop, title="Long Stop", color=longInk, linewidth=2, style=plot.style_linebr)
plot(shortStop, title="Short Stop", color=shortInk, linewidth=2, style=plot.style_linebr)`,
);

const CHANDE_KRoll = script(
    'Chande Kroll Stop',
    true,
    `p = input.int(10, "ATR Length", minval=1)
x = input.float(1.0, "ATR Multiplier", minval=0.1, step=0.1)
q = input.int(9, "Stop Length", minval=1)
longInk = input.color(${BULLISH}, "Long")
shortInk = input.color(${BEARISH}, "Short")

rangeAt = ta.atr(p) * x
firstHigh = ta.highest(high, p) - rangeAt
firstLow = ta.lowest(low, p) + rangeAt

plot(ta.lowest(firstLow, q), title="Stop Long", color=longInk, linewidth=2)
plot(ta.highest(firstHigh, q), title="Stop Short", color=shortInk, linewidth=2)`,
);

const ALLIGATOR = script(
    'Williams Alligator',
    true,
    `jawLength = input.int(13, "Jaw Length", minval=1, group="Jaw")
jawOffset = input.int(8, "Jaw Offset", minval=0, group="Jaw")
teethLength = input.int(8, "Teeth Length", minval=1, group="Teeth")
teethOffset = input.int(5, "Teeth Offset", minval=0, group="Teeth")
lipsLength = input.int(5, "Lips Length", minval=1, group="Lips")
lipsOffset = input.int(3, "Lips Offset", minval=0, group="Lips")
jawInk = input.color(color.new(${ACCENT}, 0), "Jaw", group="Colors")
teethInk = input.color(color.new(${BEARISH}, 0), "Teeth", group="Colors")
lipsInk = input.color(color.new(${BULLISH}, 0), "Lips", group="Colors")

jaw = ta.rma(hl2, jawLength)
teeth = ta.rma(hl2, teethLength)
lips = ta.rma(hl2, lipsLength)

plot(jaw, title="Jaw", color=jawInk, linewidth=2, offset=jawOffset)
plot(teeth, title="Teeth", color=teethInk, linewidth=2, offset=teethOffset)
plot(lips, title="Lips", color=lipsInk, linewidth=2, offset=lipsOffset)`,
);

const GATOR = script(
    'Gator Oscillator',
    false,
    `src = input.source(hl2, "Source")
jawLength = input.int(13, "Jaw Length", minval=1)
teethLength = input.int(8, "Teeth Length", minval=1)
lipsLength = input.int(5, "Lips Length", minval=1)
growInk = input.color(${BULLISH}, "Growing")
shrinkInk = input.color(${BEARISH}, "Shrinking")

jaw = ta.rma(src, jawLength)
teeth = ta.rma(src, teethLength)
lips = ta.rma(src, lipsLength)

upper = math.abs(jaw - teeth)
lower = -math.abs(teeth - lips)

upperInk = upper > nz(upper[1], upper) ? growInk : shrinkInk
lowerInk = lower < nz(lower[1], lower) ? growInk : shrinkInk
plot(upper, title="Upper", style=plot.style_columns, color=upperInk)
plot(lower, title="Lower", style=plot.style_columns, color=lowerInk)`,
);

const CONNORS_RSI = script(
    'Connors RSI',
    false,
    `rsiLength = input.int(3, "RSI Length", minval=2)
streakLength = input.int(2, "Streak RSI Length", minval=2)
rankLength = input.int(100, "Percent Rank Length", minval=2)
rsiInk = input.color(${BEARISH}, "RSI", inline="c")
lineInk = input.color(${NEUTRAL}, "Levels", inline="c")

var float streak = 0.0
priceChange = ta.change(close)
streak := priceChange > 0 ? math.max(streak, 0) + 1 : priceChange < 0 ? math.min(streak, 0) - 1 : 0

priceRsi = ta.rsi(close, rsiLength)
streakRsi = ta.rsi(streak, streakLength)
rank = ta.percentrank(ta.roc(close, 1), rankLength)

crsi = (priceRsi + streakRsi + rank) / 3

plot(crsi, title="Connors RSI", color=rsiInk, linewidth=2)
hline(90, title="Overbought", color=lineInk, linestyle=hline.style_dotted)
hline(10, title="Oversold", color=lineInk, linestyle=hline.style_dotted)`,
);

const SMI_ERGODIC = script(
    'SMI Ergodic',
    false,
    `longLength = input.int(20, "Long Length", minval=1)
shortLength = input.int(5, "Short Length", minval=1)
signalLength = input.int(5, "Signal Length", minval=1)
showOscillator = input.bool(false, "Show as oscillator")
growInk = input.color(${BULLISH}, "Growing")
fallInk = input.color(${BEARISH}, "Falling")

momentum = ta.change(close)
num = ta.ema(ta.ema(momentum, longLength), shortLength)
den = ta.ema(ta.ema(math.abs(momentum), longLength), shortLength)
smi = den == 0 ? 0 : 100 * num / den
signal = ta.ema(smi, signalLength)

oscillator = showOscillator ? smi - signal : smi
oscInk = showOscillator ? (oscillator >= nz(oscillator[1], oscillator) ? growInk : fallInk) : growInk

plot(oscillator, title=showOscillator ? "Oscillator" : "SMI", style=plot.style_columns, color=oscInk)
plot(showOscillator ? na : signal, title="Signal", color=fallInk, linewidth=1)
hline(0, title="Zero", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const KNOW_SURE_THING = script(
    'Know Sure Thing',
    false,
    `rocLength1 = input.int(10, "ROC Length #1", minval=1, group="ROC")
rocLength2 = input.int(15, "ROC Length #2", minval=1, group="ROC")
rocLength3 = input.int(20, "ROC Length #3", minval=1, group="ROC")
rocLength4 = input.int(30, "ROC Length #4", minval=1, group="ROC")
smaLength1 = input.int(10, "SMA Length #1", minval=1, group="Smoothing")
smaLength2 = input.int(10, "SMA Length #2", minval=1, group="Smoothing")
smaLength3 = input.int(10, "SMA Length #3", minval=1, group="Smoothing")
smaLength4 = input.int(15, "SMA Length #4", minval=1, group="Smoothing")
bullInk = input.color(${BULLISH}, "KST")
bearInk = input.color(${BEARISH}, "Signal")

r1 = ta.sma(ta.roc(close, rocLength1), smaLength1)
r2 = ta.sma(ta.roc(close, rocLength2), smaLength2)
r3 = ta.sma(ta.roc(close, rocLength3), smaLength3)
r4 = ta.sma(ta.roc(close, rocLength4), smaLength4)
kst = r1 + 2 * r2 + 3 * r3 + 4 * r4
signal = ta.sma(kst, 9)

plot(kst, title="KST", color=kst >= 0 ? bullInk : bearInk, linewidth=2)
plot(signal, title="Signal", color=bearInk)
hline(0, title="Zero", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const RVI_CLASSIC = script(
    'Relative Volatility Index',
    false,
    `stdevLength = input.int(10, "StdDev Length", minval=1)
smoothLength = input.int(14, "Smoothing Length", minval=1)
overbought = input.int(80, "Overbought", minval=1, maxval=100)
oversold = input.int(20, "Oversold", minval=0, maxval=99)
useRma = input.bool(false, "Smooth with RMA")
rviInk = input.color(${NEUTRAL}, "RVI")
levelInk = input.color(${NEUTRAL}, "Levels")

sigma = ta.stdev(close, stdevLength)
priceChange = ta.change(close)
up = priceChange > 0 ? sigma : 0
down = priceChange < 0 ? sigma : 0
upSmooth = useRma ? ta.rma(up, smoothLength) : ta.ema(up, smoothLength)
downSmooth = useRma ? ta.rma(down, smoothLength) : ta.ema(down, smoothLength)
rvi = upSmooth + downSmooth == 0 ? 0 : 100 * upSmooth / (upSmooth + downSmooth)

plot(rvi, title="RVI", color=rviInk, linewidth=2)
hline(overbought, title="Overbought", color=levelInk, linestyle=hline.style_dashed)
hline(oversold, title="Oversold", color=levelInk, linestyle=hline.style_dashed)
fill(hline(overbought), hline(oversold), color=color.new(levelInk, 97), title="Background")`,
);

const TTM_SQUEEZE = script(
    'TTM Squeeze',
    false,
    `length = input.int(20, "Length", minval=1)
bbMult = input.float(2.0, "BB StdDev", minval=0.1, step=0.1)
kcMult = input.float(1.5, "KC ATR", minval=0.1, step=0.1)
src = input.source(close, "Source")
upInk = input.color(${BULLISH}, "Up")
downInk = input.color(${BEARISH}, "Down")
dotInk = input.color(#000000, "Squeeze dot")

basis = ta.sma(src, length)
dev = bbMult * ta.stdev(src, length)
kcRange = kcMult * ta.atr(length)
rangeMid = (ta.highest(high, length) + ta.lowest(low, length)) / 2
anchor = (rangeMid + basis) / 2
mom = ta.linreg(src - anchor, length, 0)

squeezeOn = (basis + dev < basis + kcRange) and (basis - dev > basis - kcRange)
momInk = mom >= 0 ? upInk : downInk

plot(mom, title="Momentum", style=plot.style_columns, color=momInk)
plot(0, title="Zero", color=color.new(${NEUTRAL}, 60))
plotshape(squeezeOn, title="Squeeze", style=shape.xcross, location=location.bottom, color=dotInk, size=size.tiny)`,
);

const CHAIKIN_VOLATILITY = script(
    'Chaikin Volatility',
    false,
    `length = input.int(10, "Length", minval=1)
rocLength = input.int(10, "ROC Length", minval=1)
cvInk = input.color(${LINE_BLUE}, "Chaikin Volatility")
levelInk = input.color(${NEUTRAL}, "Levels")

rangeAt = high - low
smooth = ta.ema(rangeAt, length)
cv = smooth[rocLength] == 0 ? 0 : 100 * (smooth - smooth[rocLength]) / smooth[rocLength]

plot(cv, title="Chaikin Volatility", color=cvInk, linewidth=2)
hline(0, title="Zero", color=levelInk, linestyle=hline.style_dashed)`,
);

const KLINGER = script(
    'Klinger Oscillator',
    false,
    `fastLength = input.int(34, "Fast Length", minval=1)
slowLength = input.int(55, "Slow Length", minval=1)
signalLength = input.int(13, "Signal Length", minval=1)
kvoInk = input.color(${LINE_BLUE}, "KVO")
signalInk = input.color(${WARNING}, "Signal")

hlc = high + low + close
trend = hlc > hlc[1] ? 1 : -1
dm = high - low
var float cm = 0.0
cm := trend == nz(trend[1], trend) ? cm + dm : nz(dm[1], 0) + dm
volumeForce = cm == 0 ? 0 : volume * math.abs(2 * dm / cm - 1) * trend * 100

kvo = ta.ema(volumeForce, fastLength) - ta.ema(volumeForce, slowLength)
signal = ta.ema(kvo, signalLength)

plot(kvo, title="Klinger Oscillator", color=kvoInk, linewidth=2)
plot(signal, title="Signal", color=signalInk)
hline(0, title="Zero", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const PVO_STUDY = script(
    'Percentage Volume Oscillator',
    false,
    `fastLength = input.int(12, "Fast Length", minval=1)
slowLength = input.int(26, "Slow Length", minval=1)
signalLength = input.int(9, "Signal Length", minval=1)
showHistogram = input.bool(true, "Show histogram")
upInk = input.color(${BULLISH}, "Expansion")
downInk = input.color(${BEARISH}, "Contraction")
signalInk = input.color(${WARNING}, "Signal")

fast = ta.ema(volume, fastLength)
slow = ta.ema(volume, slowLength)
pvo = slow == 0 ? na : 100 * (fast - slow) / slow
signal = ta.ema(pvo, signalLength)
hist = pvo - signal

plot(showHistogram ? hist : na, title="Histogram", style=plot.style_columns, color=hist >= 0 ? color.new(upInk, 60) : color.new(downInk, 60))
plot(pvo, title="PVO", color=pvo >= signal ? upInk : downInk, linewidth=2)
plot(signal, title="Signal", color=signalInk)
hline(0, title="Zero", color=color.new(${NEUTRAL}, 50), linestyle=hline.style_dashed)`,
);

const WILLIAMS_FRACTAL = script(
    'Williams Fractal',
    true,
    `periods = input.int(2, "Periods", minval=1)
upInk = input.color(${BULLISH}, "Up fractal")
downInk = input.color(${BEARISH}, "Down fractal")

window = 2 * periods + 1
topHigh = ta.highest(high, window)
bottomLow = ta.lowest(low, window)

// The bar 'periods' back is the middle of the window that ENDS here.
downFractal = high[periods] == topHigh
upFractal = low[periods] == bottomLow

plotshape(downFractal, title="Down fractal", style=shape.triangledown, location=location.abovebar, color=downInk, offset=-periods, size=size.tiny)
plotshape(upFractal, title="Up fractal", style=shape.triangleup, location=location.belowbar, color=upInk, offset=-periods, size=size.tiny)`,
);

const ZIGZAG = script(
    'Zig Zag',
    true,
    `deviation = input.float(5.0, "Deviation %", minval=0.1, step=0.1)
depth = input.int(10, "Depth", minval=1)
lineInk = input.color(${LINE_BLUE}, "Zig Zag")

threshold = deviation / 100

var int lastIdx = na
var float lastPrice = na
var bool rising = true

pivotHigh = ta.pivothigh(high, depth, depth)
pivotLow = ta.pivotlow(low, depth, depth)
pivotIdx = bar_index - depth

if not na(pivotHigh)
    moveUp = na(lastPrice) or pivotHigh > lastPrice * (1 + threshold)
    if moveUp and not rising
        line.new(lastIdx, lastPrice, pivotIdx, pivotHigh, color=lineInk, width=2)
        lastIdx := pivotIdx
        lastPrice := pivotHigh
        rising := true

if not na(pivotLow)
    moveDown = na(lastPrice) or pivotLow < lastPrice * (1 - threshold)
    if moveDown and rising
        if not na(lastIdx)
            line.new(lastIdx, lastPrice, pivotIdx, pivotLow, color=lineInk, width=2)
        lastIdx := pivotIdx
        lastPrice := pivotLow
        rising := false`,
);


/**
 * The two LAYER-BACKED natives. They are NOT classic catalog rows, so they keep their own
 * core-computed paint path (a volume column stack and a second symbol fetched through the
 * host's feed) — but TradingView still opens a `{ }` source for them, and a trader can
 * read, copy and fork that script. These are the reference implementations of the same
 * study, written in Pine v6. VPVR (visible-range volume profile) remains the ONE study
 * without a source, exactly as on TradingView: it is a viewport-dependent layer, not a
 * plottable series.
 */
const VOLUME_NATIVE = script(
    'Volume',
    true,
    `up = input.color(${BULLISH}, "Up color")
down = input.color(${BEARISH}, "Down color")

plot(volume, title="Volume", style=plot.style_columns, color=close >= open ? up : down)`,
);

const COMPARE_NATIVE = script(
    'Compare',
    true,
    `sym = input.symbol("BTCUSDT", "Compare symbol")
tf = input.timeframe("60", "Timeframe")
ink = input.color(${ACCENT}, "Color")

otherClose = request.security(sym, tf, close)
plot(otherClose, title="Compare", color=ink, linewidth=2)`,
);

/** Sources for natives OUTSIDE the classic catalog. Kept separate so the engine's
 *  built-in fast path (which runs the classic scripts as Pine) is unchanged. */
const NATIVE_SOURCES: Record<string, string> = {
    volume: VOLUME_NATIVE,
    compare: COMPARE_NATIVE,
};

/** Titles for the editor's built-in picker — the classic catalog supplies its own. */
const NATIVE_TITLES: Record<string, string> = {
    volume: 'Volume',
    compare: 'Compare',
};

const SOURCES: Record<string, string> = {
    sma: SMA,
    ema: EMA,
    rma: RMA,
    zlema: ZLEMA,
    'moving-average': MOVING_AVERAGE,
    'ma-envelope': MA_ENVELOPE,
    'linear-regression': LINEAR_REGRESSION,
    'bollinger-bands': BOLLINGER,
    'keltner-channels': KELTNER,
    'donchian-channels': DONCHIAN,
    supertrend: SUPERTREND,
    'parabolic-sar': SAR,
    vwap: VWAP,
    rsi: RSI,
    stochastic: STOCHASTIC,
    'stochastic-rsi': STOCHASTIC_RSI,
    macd: MACD,
    ppo: PPO,
    'williams-percent-r': WILLIAMS_R,
    'commodity-channel-index': CCI,
    'awesome-oscillator': AO,
    'rate-of-change': ROC,
    trix: TRIX,
    'true-strength-index': TSI,
    'money-flow-index': MFI,
    'on-balance-volume': OBV,
    'accumulation-distribution': ADL,
    'chaikin-money-flow': CMF,
    'ease-of-movement': EOM,
    'force-index': FORCE_INDEX,
    'balance-of-power': BOP,
    'average-true-range': ATR,
    'average-directional-index': ADX,
    aroon: AROON,
    'vortex-indicator': VORTEX,
    'ultimate-oscillator': ULTIMATE,
    'choppiness-index': CHOPPINESS,
    'mass-index': MASS_INDEX,
    'standard-deviation': STD_DEV,
    'historical-volatility': HIST_VOL,
    'percent-b': PERCENT_B,
    bandwidth: BANDWIDTH,
    'coppock-curve': COPPOCK,
    'detrended-price-oscillator': DPO,
    'fisher-transform': FISHER,
    'relative-vigor-index': RVI,
    'ulcer-index': ULCER,
    'chaikin-oscillator': CHAIKIN_OSC,
    'chande-momentum-oscillator': CHANDE_MOM,
    'volume-oscillator': VOLUME_OSC,
    'price-volume-trend': PVT,
    'negative-volume-index': NVI,
    'positive-volume-index': PVI,
    'elder-ray': ELDER_RAY,
    'pivot-points': PIVOT_POINTS,
    '52-week-high-low': W52,
    'schaff-trend-cycle': SCHAFF,
    'intraday-intensity': INTENSITY,
    vidya: VIDYA_MARGIN,
    'volume-flow-indicator': VOLUME_FLOW,
    'chandelier-exit': CHANDELIER_EXIT,
    'chande-kroll-stop': CHANDE_KRoll,
    'williams-alligator': ALLIGATOR,
    'gator-oscillator': GATOR,
    'connors-rsi': CONNORS_RSI,
    'smi-ergodic': SMI_ERGODIC,
    'know-sure-thing': KNOW_SURE_THING,
    'relative-volatility-index': RVI_CLASSIC,
    'ttm-squeeze': TTM_SQUEEZE,
    'chaikin-volatility': CHAIKIN_VOLATILITY,
    'klinger-oscillator': KLINGER,
    pvo: PVO_STUDY,
    'williams-fractal': WILLIAMS_FRACTAL,
    zigzag: ZIGZAG,
};

/** The Pine v6 source behind a CLASSIC built-in study, or `undefined` when it has none.
 *  This is also the set the engine may EXECUTE in place of the core compute. */
export function classicPineSource(type: string): string | undefined {
    return SOURCES[type];
}

/** The Pine source a study's `{ }` action opens — classic scripts AND the two
 *  layer-backed natives. This is the truth source for "every indicator has Pine". */
export function builtinPineSource(type: string): string | undefined {
    return SOURCES[type] ?? NATIVE_SOURCES[type];
}

/** Every built-in that ships a Pine source (editor list + test contract). */
export function builtinPineIndex(): Array<{ type: string; source: string }> {
    return [...classicPineIndex(), ...Object.entries(NATIVE_SOURCES).map(([type, source]) => ({ type, source }))];
}

/** The editor's built-in scripts… picker: title-sorted, including the two natives. */
export function builtinPineEntries(): Array<{ type: string; title: string; source: string }> {
    const titles = new Map<string, string>(classicSpecs.map((spec) => [spec.type, spec.title]));
    for (const [type, title] of Object.entries(NATIVE_TITLES)) titles.set(type, title);
    return Object.entries({ ...SOURCES, ...NATIVE_SOURCES })
        .map(([type, source]) => ({ type, title: titles.get(type) ?? type, source }))
        .sort((a, b) => a.title.localeCompare(b.title));
}

/** Every built-in study that ships a Pine implementation (the editor's "Built-in" list). */
export function classicPineIndex(): Array<{ type: string; source: string }> {
    return Object.entries(SOURCES).map(([type, source]) => ({ type, source }));
}

/** The built-in list as the editor's "Built-in scripts…" picker shows it: title-sorted. */
export function classicPineEntries(): Array<{ type: string; title: string; source: string }> {
    const titles = new Map(classicSpecs.map((spec) => [spec.type, spec.title]));
    return Object.entries(SOURCES)
        .map(([type, source]) => ({ type, title: titles.get(type) ?? type, source }))
        .sort((a, b) => a.title.localeCompare(b.title));
}
