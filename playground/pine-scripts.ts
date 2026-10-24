// Pine Script v6 scripts shipped with the playground's indicator manifest.
//
// They are ordinary Pine — the same text you would paste into any chart — executed by
// `vela-pine-libre` (registered as the `pine` engine in workspace.ts). Entries are
// `enabled: false` so they start in the Indicators picker rather than on the chart: a
// workspace that boots with four strategies running would be noise.
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
    { name: "Pine · MACD Strategy", script: MACD_STRATEGY, language: "pine", enabled: false, category: "Pine Script" },
    { name: "Pine · Donchian Breakout", script: DONCHIAN_STRATEGY, language: "pine", enabled: false, category: "Pine Script" },
];
