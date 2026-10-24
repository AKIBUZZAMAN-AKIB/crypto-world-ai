// The STRATEGY REPORT as data: the numbers a backtest report shows, computed from the
// broker state a strategy's run carries and its ledger of round trips. No DOM and no chart
// calls, so every rule here is unit-testable on plain objects — the tester panel only
// formats what this returns.
//
// The vocabulary follows the reference platform's report so a trader reads it the same way:
// Net profit is the sum of closed round trips, Gross profit / Gross loss are the sums of the
// positive / negative ones (gross loss kept as a POSITIVE magnitude, the caller renders the
// sign), Percent profitable divides winners by CLOSED trades, and an open trade counts in
// neither. Every optional metric is `null` when the data cannot answer it (an engine with no
// per-trade ledger, a zero denominator) rather than a fabricated zero.
import type { StrategyState, StrategyTrade } from './model/strategy';

/** Which way a round trip ran. */
export type TradeSide = 'long' | 'short';

/** One row of the List of trades table. */
export interface TradeReportRow {
    /** Trade # — 1-based, closed trades in the order they closed, open ones last. */
    n: number;
    side: TradeSide;
    qty: number;
    entryTime: number;
    entryPrice: number;
    exitTime: number | null;
    exitPrice: number | null;
    /** Net P&L of the round trip; null while open (or when the engine reports none). */
    pnl: number | null;
    /** Running total of `pnl` over the closed trades up to and including this one. */
    cumulative: number | null;
    /** Favorable / adverse excursion for this trade (positive magnitudes), when reported. */
    runup: number | null;
    drawdown: number | null;
    /** Bars the trade was held (entry to exit) — null when the timeframe is unknown or the trade is open. */
    bars: number | null;
    open: boolean;
}

/** One column of the Performance table (All / Long / Short). */
export interface ReportStats {
    /** Closed round trips counted here. */
    trades: number;
    /** Trades still open at the last computed bar. */
    openTrades: number;
    wins: number;
    losses: number;
    even: number;
    netProfit: number;
    /** Sum of the winning trades — never negative. */
    grossProfit: number;
    /** Sum of the losing trades as a POSITIVE magnitude — never negative. */
    grossLoss: number;
    /** Commission charged over every trade that reports one. */
    commission: number;
    maxDrawdown: number;
    maxRunup: number;
    /** `wins / trades · 100`; null with no closed trades. */
    percentProfitable: number | null;
    /** `netProfit / trades`; null with no closed trades. */
    avgTrade: number | null;
    avgWin: number | null;
    /** Average losing trade as a POSITIVE magnitude. */
    avgLoss: number | null;
    /** `avgWin / avgLoss`; null with no losing trades (the ratio is infinite). */
    ratioWinLoss: number | null;
    /** The best round trip; null with none. */
    largestWin: number | null;
    /** The worst round trip as a POSITIVE magnitude; null with none. */
    largestLoss: number | null;
    /** `grossProfit / grossLoss`; null when the loss side is zero. */
    profitFactor: number | null;
    /** Average number of bars a closed trade was HELD (entry bar to exit bar); null without a timeframe. */
    avgBars: number | null;
}

/** Everything the tester panel needs, in display order. */
export interface StrategyReport {
    /** Net profit as a percentage of the strategy's initial capital; null when it is unknown. */
    returnPct: number | null;
    initialCapital: number | null;
    /** All closed + open trades. */
    all: ReportStats;
    /** The long / short slices — null when the engine reports no ledger to split. */
    long: ReportStats | null;
    short: ReportStats | null;
    /** List of trades, closed ones in exit order then the open ones. */
    rows: TradeReportRow[];
    /** Cumulative net P&L after each closed trade, for the overview chart. */
    equity: Array<{ time: number; value: number }>;
}

/** What {@link buildStrategyReport} needs beyond the trades themselves. */
export interface ReportOptions {
    /** Milliseconds per bar on the chart the strategy ran on — enables the bar-count rows. */
    barMs?: number | null;
    /** Overrides for the account-level figures when no per-trade ledger is available. */
    state?: StrategyState | null;
}

const EMPTY_STATS: ReportStats = {
    trades: 0,
    openTrades: 0,
    wins: 0,
    losses: 0,
    even: 0,
    netProfit: 0,
    grossProfit: 0,
    grossLoss: 0,
    commission: 0,
    maxDrawdown: 0,
    maxRunup: 0,
    percentProfitable: null,
    avgTrade: null,
    avgWin: null,
    avgLoss: null,
    ratioWinLoss: null,
    largestWin: null,
    largestLoss: null,
    profitFactor: null,
    avgBars: null,
};

/** The trades still open (no exit, or flagged open). */
function isOpen(t: StrategyTrade): boolean {
    return t.open || !t.exit;
}

/** A finite number, or null — the guard every optional metric goes through. */
function num(v: number | undefined | null): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * One column of the Performance table from a set of trades. Trades without a reported P&L
 * cannot be classified, so they still count as trades but land in neither winners nor
 * losers — the same way the reference handles an open position.
 */
export function statsFor(trades: readonly StrategyTrade[], barMs?: number | null): ReportStats {
    const closed = trades.filter((t) => !isOpen(t));
    const openTrades = trades.length - closed.length;
    if (closed.length === 0) {
        return { ...EMPTY_STATS, openTrades };
    }
    let wins = 0;
    let losses = 0;
    let even = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let commission = 0;
    let largestWin = 0;
    let largestLoss = 0;
    let pnlSum = 0;
    let pnlCount = 0;
    let barsSum = 0;
    let barsCount = 0;
    for (const t of closed) {
        if (typeof t.commission === 'number' && Number.isFinite(t.commission)) commission += t.commission;
        const pnl = num(t.pnl);
        if (pnl == null) continue;
        pnlCount += 1;
        pnlSum += pnl;
        if (pnl > 0) {
            wins += 1;
            grossProfit += pnl;
            if (pnl > largestWin) largestWin = pnl;
        } else if (pnl < 0) {
            losses += 1;
            grossLoss += -pnl;
            if (-pnl > largestLoss) largestLoss = -pnl;
        } else {
            even += 1;
        }
        const exit = t.exit;
        // Entry bar → exit bar, the reference's "bars in trade" (not the candle-to-candle span of the data).
        if (barMs && barMs > 0 && exit) {
            const bars = Math.max(0, Math.round((exit.time - t.entry.time) / barMs));
            barsSum += bars;
            barsCount += 1;
        }
    }
    // Ratios divide by the CLOSED trade count (the reference's rule): a closed trade whose
    // P&L the engine did not report still happened, it just cannot be classified.
    const total = closed.length;
    const netProfit = pnlCount > 0 ? pnlSum : 0;
    return {
        trades: closed.length,
        openTrades,
        wins,
        losses,
        even,
        netProfit,
        grossProfit,
        grossLoss,
        commission,
        // Per-trade extremes are not account drawdowns; they stay 0 unless the caller
        // supplies the account figures (see `mergeState`).
        maxDrawdown: 0,
        maxRunup: 0,
        percentProfitable: total > 0 ? (wins / total) * 100 : null,
        avgTrade: total > 0 ? netProfit / total : null,
        avgWin: wins > 0 ? grossProfit / wins : null,
        avgLoss: losses > 0 ? grossLoss / losses : null,
        ratioWinLoss: wins > 0 && losses > 0 && grossLoss > 0 ? grossProfit / wins / (grossLoss / losses) : null,
        largestWin: wins > 0 ? largestWin : null,
        largestLoss: losses > 0 ? largestLoss : null,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
        avgBars: barsCount > 0 ? barsSum / barsCount : null,
    };
}

/**
 * Merge the account-level figures a strategy's run reports (drawdown, run-up) into a column
 * built from trades. Only the account run applies to the All column — a Long/South slice has
 * no drawdown of its own, so those stay 0.
 */
export function mergeState(stats: ReportStats, state: StrategyState | null | undefined): ReportStats {
    if (!state) return stats;
    const maxDrawdown = num(state.maxDrawdown);
    const maxRunup = num(state.maxRunup);
    return {
        ...stats,
        maxDrawdown: maxDrawdown != null ? Math.abs(maxDrawdown) : stats.maxDrawdown,
        maxRunup: maxRunup != null ? Math.abs(maxRunup) : stats.maxRunup,
    };
}

/**
 * The account-level column when the engine exposes NO per-trade ledger: everything the run's
 * broker state can answer, and nulls where only a ledger could. `wins`/`losses` come from the
 * state's own counters, so Percent profitable is still exact.
 */
export function statsFromState(state: StrategyState): ReportStats {
    const wins = Math.max(0, Math.round(num(state.wins) ?? 0));
    const losses = Math.max(0, Math.round(num(state.losses) ?? 0));
    const even = Math.max(0, Math.round(num(state.even) ?? 0));
    const classified = wins + losses + even;
    const grossProfit = Math.max(0, num(state.grossProfit) ?? 0);
    const grossLoss = Math.abs(num(state.grossLoss) ?? 0);
    const netProfit = num(state.netPnl) ?? grossProfit - grossLoss;
    return {
        trades: classified,
        openTrades: Math.abs(state.position) > 0 ? 1 : 0,
        wins,
        losses,
        even,
        netProfit,
        grossProfit,
        grossLoss,
        commission: 0,
        maxDrawdown: Math.abs(num(state.maxDrawdown) ?? 0),
        maxRunup: Math.abs(num(state.maxRunup) ?? 0),
        percentProfitable: classified > 0 ? (wins / classified) * 100 : null,
        avgTrade: classified > 0 ? netProfit / classified : null,
        avgWin: wins > 0 ? grossProfit / wins : null,
        avgLoss: losses > 0 ? grossLoss / losses : null,
        ratioWinLoss: wins > 0 && losses > 0 && grossLoss > 0 ? grossProfit / wins / (grossLoss / losses) : null,
        largestWin: null,
        largestLoss: null,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
        avgBars: null,
    };
}

/** Sort closed trades by exit time (then by entry), open ones last in entry order. */
function orderedTrades(trades: readonly StrategyTrade[]): StrategyTrade[] {
    const closed = trades.filter((t) => !isOpen(t));
    const open = trades.filter((t) => isOpen(t));
    const key = (t: StrategyTrade): number => t.exit?.time ?? t.entry.time;
    closed.sort((a, b) => key(a) - key(b) || a.entry.time - b.entry.time);
    open.sort((a, b) => a.entry.time - b.entry.time);
    return [...closed, ...open];
}

/** The List-of-trades rows, numbered in display order with a running total. */
export function tradeRows(trades: readonly StrategyTrade[], barMs?: number | null): TradeReportRow[] {
    const rows: TradeReportRow[] = [];
    let cumulative = 0;
    let sawPnl = false;
    trades.forEach((t, i) => {
        const open = isOpen(t);
        const pnl = open ? null : num(t.pnl);
        if (pnl != null) {
            cumulative += pnl;
            sawPnl = true;
        }
        const exit = open ? null : (t.exit ?? null);
        rows.push({
            n: i + 1,
            side: t.side,
            qty: t.qty,
            entryTime: t.entry.time,
            entryPrice: t.entry.price,
            exitTime: exit ? exit.time : null,
            exitPrice: exit ? exit.price : null,
            pnl,
            cumulative: pnl != null && sawPnl ? cumulative : null,
            runup: num(t.maxRunup),
            drawdown: num(t.maxDrawdown),
            bars: barMs && barMs > 0 && exit ? Math.max(0, Math.round((exit.time - t.entry.time) / barMs)) : null,
            open,
        });
    });
    return rows;
}

/**
 * The whole report. `trades` empty + a `state` ⇒ the state-only column (an engine with no
 * ledger); `trades` present ⇒ every column is built from them, with the account figures
 * merged in from `state` where it has them.
 */
export function buildStrategyReport(trades: readonly StrategyTrade[], opts: ReportOptions = {}): StrategyReport {
    const state = opts.state ?? null;
    const ordered = orderedTrades(trades);
    const rows = tradeRows(ordered, opts.barMs);
    const hasLedger = ordered.length > 0;
    // A ledger with no reported P&L cannot answer the money rows: take those from the
    // account state and keep what the ledger alone knows (the counts, the commission).
    const ledgerPnl = ordered.some((t) => !isOpen(t) && typeof t.pnl === 'number');
    let all: ReportStats;
    if (!hasLedger) {
        all = state ? statsFromState(state) : { ...EMPTY_STATS };
    } else if (!ledgerPnl && state) {
        const fromState = statsFromState(state);
        const fromTrades = statsFor(ordered, opts.barMs);
        all = { ...fromState, trades: fromTrades.trades, openTrades: fromTrades.openTrades, commission: fromTrades.commission };
    } else {
        all = mergeState(statsFor(ordered, opts.barMs), state);
    }
    const long = hasLedger ? mergeState(statsFor(ordered.filter((t) => t.side === 'long'), opts.barMs), null) : null;
    const short = hasLedger ? mergeState(statsFor(ordered.filter((t) => t.side === 'short'), opts.barMs), null) : null;
    const equity: Array<{ time: number; value: number }> = [];
    const first = ordered[0];
    if (first) equity.push({ time: first.entry.time, value: 0 });
    let running = 0;
    for (const row of rows) {
        if (row.open || row.pnl == null || row.exitTime == null) continue;
        running += row.pnl;
        equity.push({ time: row.exitTime, value: running });
    }
    const initialCapital = num(state?.initialCapital);
    return {
        returnPct: initialCapital && initialCapital > 0 ? (all.netProfit / initialCapital) * 100 : null,
        initialCapital,
        all,
        long,
        short,
        rows,
        equity,
    };
}
