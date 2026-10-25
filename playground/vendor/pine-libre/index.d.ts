/**
 * Abstract syntax tree for the supported Pine subset.
 *
 * Every node carries a source position and call-site expressions carry a stable `id`
 * assigned at parse time. The runtime uses those ids as the identity of per-call-site
 * state (a `ta.ema()` instance lives at its call site), which is what Pine's own
 * semantics require: two `ta.ema` calls in one script are two independent series.
 */
interface Pos {
    line: number;
    col: number;
}
type Arg = {
    name?: string;
    value: Expr;
};
type Expr = ({
    kind: 'num';
    value: number;
} & Pos) | ({
    kind: 'str';
    value: string;
} & Pos) | ({
    kind: 'bool';
    value: boolean;
} & Pos) | ({
    kind: 'na';
} & Pos) | ({
    kind: 'ident';
    name: string;
} & Pos) | ({
    kind: 'member';
    object: Expr;
    prop: string;
} & Pos) | ({
    kind: 'call';
    callee: Expr;
    args: Arg[];
    id: number;
} & Pos) | ({
    kind: 'bin';
    op: string;
    left: Expr;
    right: Expr;
} & Pos) | ({
    kind: 'un';
    op: string;
    arg: Expr;
} & Pos) | ({
    kind: 'ternary';
    cond: Expr;
    then: Expr;
    else: Expr;
} & Pos) | ({
    kind: 'history';
    object: Expr;
    offset: Expr;
} & Pos) | ({
    kind: 'array';
    items: Expr[];
} & Pos) | ({
    kind: 'tuple';
    items: Expr[];
} & Pos) | ({
    kind: 'if';
    cond: Expr;
    then: Stmt[];
    else: Stmt[] | null;
    exprMode: boolean;
} & Pos) | ({
    kind: 'switch';
    subject: Expr | null;
    cases: SwitchCase[];
    exprMode: boolean;
} & Pos) | ({
    kind: 'lambda';
    params: Param[];
    body: Stmt[];
    exprBody: Expr | null;
} & Pos);
interface SwitchCase {
    /** `null` for the default (`=> value`) case. */
    test: Expr | null;
    body: Stmt[];
    exprBody: Expr | null;
}
interface Param {
    name: string;
    def: Expr | null;
    /** `method name(Type self, …)` — the declared type of the receiver. */
    type?: string | null;
}
/** One field of a `type` declaration. */
interface TypeField {
    name: string;
    /** Declared field type (`float`, `array<float>`, another UDT, …), or `null`. */
    type: string | null;
    def: Expr | null;
}
/** One entry of an `enum` declaration. */
interface EnumMember {
    name: string;
    value: Expr | null;
}
type AssignTarget = {
    kind: 'ident';
    name: string;
    pos: Pos;
} | {
    kind: 'member';
    object: Expr;
    prop: string;
    pos: Pos;
} | {
    kind: 'tuple';
    items: AssignTarget[];
    pos: Pos;
};
type DeclKind = 'none' | 'var' | 'varip';
type Stmt = ({
    kind: 'expr';
    expr: Expr;
} & Pos) | ({
    kind: 'assign';
    targets: AssignTarget[];
    op: string;
    decl: DeclKind;
    expr: Expr;
} & Pos) | ({
    kind: 'if';
    cond: Expr;
    then: Stmt[];
    else: Stmt[] | null;
    exprMode: boolean;
} & Pos) | ({
    kind: 'for';
    varName: string;
    from: Expr;
    to: Expr;
    step: Expr | null;
    body: Stmt[];
} & Pos) | ({
    kind: 'forin';
    varName: string;
    varName2?: string | null;
    iterable: Expr;
    body: Stmt[];
} & Pos) | ({
    kind: 'while';
    cond: Expr;
    body: Stmt[];
} & Pos) | ({
    kind: 'break';
} & Pos) | ({
    kind: 'continue';
} & Pos) | ({
    kind: 'func';
    name: string;
    params: Param[];
    body: Stmt[];
    exprBody: Expr | null;
    id: number;
    /** Declared with `export` (library members only importers can see). */
    exported?: boolean;
    /** `method` declaration: the first parameter is the receiver. */
    method?: boolean;
} & Pos) | ({
    kind: 'return';
    expr: Expr | null;
} & Pos) | ({
    kind: 'import';
    path: string;
    alias: string;
} & Pos) | ({
    kind: 'typedef';
    name: string;
    fields: TypeField[];
    exported?: boolean;
} & Pos) | ({
    kind: 'enumdef';
    name: string;
    members: EnumMember[];
    exported?: boolean;
} & Pos) | ({
    kind: 'switch';
    subject: Expr | null;
    cases: SwitchCase[];
    exprMode: boolean;
} & Pos) | ({
    kind: 'empty';
} & Pos);
interface Script {
    /** Declared `//@version=N`, or `null` when absent. */
    version: number | null;
    body: Stmt[];
}

/**
 * Runtime value model.
 *
 * Pine's type system is small: int, float, bool, string, color, plus `na` and the
 * collection/object types. This engine represents:
 *   na      -> `null`
 *   int     -> a JS number with `Number.isInteger(v)` true
 *   float   -> any other finite JS number (Infinity/-Infinity/NaN follow Pine: NaN maps to na)
 *   bool    -> JS boolean
 *   string  -> JS string
 *   color   -> PineColor instance (CSS rgba string inside)
 *   arrays  -> PineArray
 * Everything else that a script can hold (plot references, label/line handles) is an object
 * with a `__pine` tag.
 */
declare class PineColor {
    readonly css: string;
    constructor(css: string);
    /** Same colour at a different transparency (the v1–v4 `transp` argument). */
    withTransp(transp: number): PineColor;
    toString(): string;
    valueOf(): string;
}
type PineValue = number | string | boolean | PineColor | null | PineObject;
/** Any tagged engine object (array, tuple, plot reference, lambda…). */
interface PineObject {
    readonly __pine: string;
    [key: string]: unknown;
}
/** Pine colour names -> CSS colours (the documented `color.*` palette). */
declare const COLOR_NAMES: Record<string, string>;
/** Pine `array<...>` — a growable list with Pine's indexing rules. */
declare class PineArray implements PineObject {
    readonly __pine = "array";
    [key: string]: unknown;
    items: PineValue[];
    readonly elemType: string;
    constructor(items?: PineValue[], elemType?: string);
    get size(): number;
    toStr(): string;
    /** Pine `array.get`: out-of-range yields na. */
    get(index: number): PineValue;
    set(index: number, value: PineValue): void;
    push(value: PineValue): void;
    pop(): PineValue;
    shift(): PineValue;
    unshift(value: PineValue): void;
    clear(): void;
    /** Deep-ish copy (copies the array, not the contained objects — same as Pine). */
    clone(): PineArray;
}

/**
 * Structural declarations of the host chart library's vocabulary.
 *
 * These are *shapes only*. They are independently written from the publicly documented
 * Apache-2.0 `ScriptingEngine` port contract (see docs/clean-room.md, "Interface
 * provenance"): the field names and semantics are an interoperability interface, and no
 * implementation code was copied. A host that installs `@luxalgo/vela` satisfies these
 * structurally; the engine never imports the host package at runtime.
 */
type Millis = number;
interface OHLCV {
    time: Millis;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}
type InputValue = number | string | boolean;
type InputType = 'int' | 'float' | 'bool' | 'string' | 'source' | 'color' | 'price' | 'time' | 'session' | 'timeframe' | 'symbol' | 'text_area';
interface InputSchema {
    key: string;
    title: string;
    type: InputType;
    defval: InputValue;
    min?: number;
    max?: number;
    step?: number;
    options?: readonly string[];
    group?: string;
    inline?: string;
    tooltip?: string;
}
interface IndicatorMeta {
    title: string;
    shorttitle?: string;
    overlay: boolean;
    precision?: number;
    format?: string;
}
type LineLikeKind = 'line' | 'area' | 'step' | 'histogram' | 'columns' | 'circles' | 'cross';
type LineStyle = 'solid' | 'dashed' | 'dotted';
interface SeriesPoint {
    time: Millis;
    value: number | null;
    color?: string;
}
interface LineLikeStyle {
    color: string;
    width: number;
    lineStyle: LineStyle;
    base?: number;
}
interface MarkerPoint {
    time: Millis;
    position: 'aboveBar' | 'belowBar' | 'inBar';
    shape: string;
    color: string;
    text?: string;
    size?: 'tiny' | 'small' | 'normal' | 'large' | 'huge';
    /** Exact y of the glyph for `location.absolute` (TV paints the shape AT the series value). */
    price?: number;
    /** Label text ink (Pine `textcolor`). */
    textColor?: string;
}
interface SeriesBase {
    id: string;
    title: string;
    paneId: string;
    overlay?: boolean;
    visible?: boolean;
}
interface LineLikeSeries extends SeriesBase {
    kind: LineLikeKind;
    points: SeriesPoint[];
    style: LineLikeStyle;
}
interface MarkerSeries extends SeriesBase {
    kind: 'markers';
    markers: MarkerPoint[];
}
type SeriesSpec = LineLikeSeries | MarkerSeries;
/** One candle of a `plotcandle()` / `plotbar()` series. */
interface CandlePoint {
    time: Millis;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    color?: string | null;
    borderColor?: string | null;
    wickColor?: string | null;
}
interface CandleSeries extends SeriesBase {
    kind: 'candles' | 'bars';
    candles: CandlePoint[];
}
interface Fill {
    id: string;
    paneId: string;
    /** Anchor series for a `fill(plot1, plot2, …)` band (absent for price bands). */
    fromSeriesId?: string;
    /** Anchor series for a `fill(plot1, plot2, …)` band (absent for price bands). */
    toSeriesId?: string;
    /** Upper price of a `fill(hline1, hline2, …)` band — a horizontal band across the pane. */
    fromPrice?: number;
    /** Lower price of a `fill(hline1, hline2, …)` band. */
    toPrice?: number;
    color?: string;
    colors?: Array<string | null>;
    overlay?: boolean;
}
interface Background {
    id: string;
    paneId: string;
    from: Millis;
    to: Millis;
    color: string;
    overlay?: boolean;
}
interface PriceLine {
    id: string;
    paneId: string;
    price: number;
    color?: string;
    lineStyle?: LineStyle;
    width?: number;
    title?: string;
}
interface TradeExecution {
    time: Millis;
    price: number;
    side: 'buy' | 'sell';
    kind: 'entry' | 'exit';
    label?: string;
    qty?: number;
    tradeId?: string;
}
interface IndicatorModel {
    id: string;
    title: string;
    shorttitle?: string;
    overlay: boolean;
    paneHint: 'price' | 'new';
    series: SeriesSpec[];
    /** `plotcandle()` / `plotbar()` output. */
    candleSeries?: CandleSeries[];
    fills: Fill[];
    backgrounds: Background[];
    priceLines: PriceLine[];
    lines?: DrawingLine[];
    boxes?: DrawingBox[];
    labels?: DrawingLabel[];
    polylines?: DrawingPolyline[];
    linefills?: DrawingLinefill[];
    tables?: DrawingTable[];
    barColors?: Array<{
        time: Millis;
        color: string;
    }>;
    trades?: TradeExecution[];
    inputs: InputSchema[];
    inputValues: Record<string, InputValue>;
    props?: InputSchema[];
    propValues?: Record<string, InputValue>;
}
interface StrategyState {
    position: number;
    avgPrice: number;
    equity: number;
    openPnl: number;
    netPnl: number;
    grossProfit: number;
    grossLoss: number;
    wins: number;
    losses: number;
    even: number;
    maxDrawdown: number;
    maxRunup: number;
    initialCapital: number;
}
interface StrategyFill {
    id: string;
    time: Millis;
    price: number;
    comment?: string;
}
interface StrategyTrade {
    id: string;
    side: 'long' | 'short';
    qty: number;
    entry: StrategyFill;
    exit?: StrategyFill;
    open: boolean;
    pnl?: number;
    commission?: number;
    /** Bar index of the entry / exit fill (`strategy.closedtrades.entry_bar_index()`). */
    entryBarIndex?: number;
    exitBarIndex?: number;
    /** Favorable / adverse excursions while the trade was open. */
    maxRunup?: number;
    maxDrawdown?: number;
    maxRunupPercent?: number;
    maxDrawdownPercent?: number;
}
interface SymbolInfo {
    ticker?: string;
    mintick?: number;
    [key: string]: unknown;
}
interface BarRange {
    from?: number;
    to?: number;
    limit?: number;
}
type FetchSeries = (symbol: string, timeframe: string, range: BarRange) => Promise<OHLCV[]>;
interface VisibleBarRange {
    left: number;
    right: number;
}
interface EngineAlert {
    id: string;
    message: string;
    title?: string;
    time: number;
    barIndex: number;
    freq?: string;
}
interface EngineWarning {
    message: string;
    method?: string;
    bar: number;
}
interface PreparedScript {
    language: string;
    inputs: InputSchema[];
    props?: InputSchema[];
    meta: IndicatorMeta;
    reactsToViewport: boolean;
    readonly token: unknown;
}
interface EngineCapabilities {
    streaming: boolean;
    visibleRange: boolean;
    inputs: boolean;
    props?: boolean;
}
interface ExecutionMarket {
    symbol: string;
    timeframe: string;
    symbolInfo?: SymbolInfo;
    chartStyle?: string;
}
interface ExecutionRequest {
    prepared: PreparedScript;
    market: ExecutionMarket;
    bars: OHLCV[];
    getBars?: () => OHLCV[];
    fetchSeries?: FetchSeries;
    inputs?: Record<string, InputValue>;
    props?: Record<string, InputValue>;
    visibleRange?: VisibleBarRange;
    mode: 'static' | 'live';
    historyState?: 'backfill' | 'complete';
}
interface ExecutionHandlers {
    onModel(model: IndicatorModel): void;
    onAlert?(alert: EngineAlert): void;
    onWarning?(warning: EngineWarning): void;
    onError?(error: Error): void;
    onDone?(): void;
}
type BarsChangeReason = 'backfill' | 'complete';
interface EngineContextSnapshot {
    language: string;
    phase: 'idle' | 'computing' | 'streaming';
    barIndex: number;
    meta: {
        title: string;
        overlay: boolean;
        precision?: number;
        shorttitle?: string;
    };
    plots: Record<string, ReadonlyArray<{
        time: number;
        value: unknown;
    }>>;
    variables: Record<string, unknown>;
    strategy?: StrategyState;
    trades?: StrategyTrade[];
    warnings: EngineWarning[];
}
type ContextSelect = ReadonlyArray<keyof EngineContextSnapshot>;
interface ExecutionSession {
    getContext?(select?: ContextSelect): Promise<EngineContextSnapshot | null>;
    stop(): void;
    update(inputs: Record<string, InputValue>, props?: Record<string, InputValue>): void;
    setVisibleRange(range: VisibleBarRange): void;
    notifyBars(reason?: BarsChangeReason): void;
}
interface ScriptingEngine {
    readonly language: string;
    readonly capabilities: EngineCapabilities;
    prepare(source: string, instanceId: string): Promise<PreparedScript>;
    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession;
}
type DrawingXLoc = 'bar_index' | 'bar_time';
type DrawingExtend = 'none' | 'left' | 'right' | 'both';
type TextSizeName = 'auto' | 'tiny' | 'small' | 'normal' | 'large' | 'huge';
type HAlign = 'left' | 'center' | 'right';
type VAlign = 'top' | 'center' | 'bottom';
type FontFamily = 'default' | 'monospace';
interface DrawingLine {
    id: string;
    paneId: string;
    xloc: DrawingXLoc;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    extend: DrawingExtend;
    color?: string;
    invisible: boolean;
    width: number;
    style: LineStyle;
    arrowLeft: boolean;
    arrowRight: boolean;
    overlay?: boolean;
}
interface DrawingBox {
    id: string;
    paneId: string;
    xloc: DrawingXLoc;
    left: number;
    top: number;
    right: number;
    bottom: number;
    extend: DrawingExtend;
    bgColor?: string;
    borderColor?: string;
    borderWidth: number;
    borderStyle: LineStyle;
    text?: string;
    textColor?: string;
    textSize: TextSizeName;
    hAlign: HAlign;
    vAlign: VAlign;
    wrap: boolean;
    fontFamily: FontFamily;
    bold: boolean;
    italic: boolean;
    overlay?: boolean;
}
type LabelStyleName = 'label_up' | 'label_down' | 'label_left' | 'label_right' | 'label_center' | 'label_lower_left' | 'label_lower_right' | 'label_upper_left' | 'label_upper_right' | 'circle' | 'square' | 'diamond' | 'flag' | 'arrowup' | 'arrowdown' | 'triangleup' | 'triangledown' | 'cross' | 'xcross' | 'text_outline' | 'none';
interface DrawingLabel {
    id: string;
    paneId: string;
    xloc: DrawingXLoc;
    x: number;
    y: number;
    yloc: 'price' | 'abovebar' | 'belowbar' | 'top' | 'bottom';
    text?: string;
    style: LabelStyleName;
    color?: string;
    textColor?: string;
    size: TextSizeName;
    textAlign: HAlign;
    tooltip?: string;
    fontFamily: FontFamily;
    bold?: boolean;
    italic?: boolean;
    noFill?: boolean;
    overlay?: boolean;
}
interface PolylinePoint {
    xloc: DrawingXLoc;
    x: number;
    price: number;
}
interface DrawingPolyline {
    id: string;
    paneId: string;
    points: PolylinePoint[];
    curved: boolean;
    closed: boolean;
    lineColor?: string;
    fillColor?: string;
    lineWidth: number;
    lineStyle: LineStyle;
    arrowLeft: boolean;
    arrowRight: boolean;
    overlay?: boolean;
}
interface DrawingLinefill {
    id: string;
    paneId: string;
    line1: DrawingLine;
    line2: DrawingLine;
    color?: string;
    overlay?: boolean;
}
type TablePosition = 'top_left' | 'top_center' | 'top_right' | 'middle_left' | 'middle_center' | 'middle_right' | 'bottom_left' | 'bottom_center' | 'bottom_right';
interface TableCell {
    text?: string;
    textColor?: string;
    bgColor?: string;
    hAlign: HAlign;
    vAlign: VAlign;
    textSize: TextSizeName | number;
    fontFamily: FontFamily;
    tooltip?: string;
    bold: boolean;
    italic: boolean;
    width?: number;
    height?: number;
    merged?: boolean;
}
interface TableMerge {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
}
interface DrawingTable {
    id: string;
    paneId: string;
    position: TablePosition;
    columns: number;
    rows: number;
    bgColor?: string;
    frameColor?: string;
    frameWidth: number;
    borderColor?: string;
    borderWidth: number;
    cells: Array<Array<TableCell | null>>;
    merges: TableMerge[];
    overlay?: boolean;
}

/**
 * Static analysis performed by `prepare()`: everything that can be known about a script
 * without any market data.
 *
 *  - the `indicator()` / `strategy()` declaration → title, overlay, precision and the
 *    mutable property schema;
 *  - every `input.*()` call → its key, type and default;
 *  - `request.security()` targets, so the host data can be fetched before execution;
 *  - `import` statements, so the resolver can be consulted;
 *  - whether the script reads a viewport builtin (`chart.*`).
 */

interface PropSpec {
    type: InputType;
    def?: InputValue;
    options?: readonly string[];
}
/** Mutable declaration arguments this engine exposes as property overrides. */
declare const STRATEGY_PROP_SPECS: Record<string, PropSpec>;
declare const INDICATOR_PROP_SPECS: Record<string, PropSpec>;
interface ImportDecl {
    path: string;
    alias: string;
    line: number;
}
interface SecurityRequest {
    symbol: string;
    timeframe: string;
    callId: number;
}
/** A `request.security` call site, kept so the symbol/timeframe can be re-evaluated
 *  against the *execution* market (prepare has no symbol). */
interface SecurityCall {
    /** `true` for `request.security_lower_tf`. */
    lower?: boolean;
    callId: number;
    symbolExpr: Expr;
    timeframeExpr: Expr;
}
interface AnalyzedScript {
    script: Script;
    meta: IndicatorMeta;
    isStrategy: boolean;
    /** Declaration argument values keyed by parameter name. */
    declarationArgs: Map<string, PineValue>;
    inputs: InputSchema[];
    inputDefaults: Record<string, InputValue>;
    /** Input call node id → schema key. */
    inputKeys: Map<number, string>;
    props: InputSchema[];
    propDefaults: Record<string, InputValue>;
    imports: ImportDecl[];
    securities: SecurityRequest[];
    securityCalls: SecurityCall[];
    reactsToViewport: boolean;
    warnings: string[];
}
interface AnalyzeOptions {
    instanceId: string;
    market: {
        symbol: string;
        timeframe: string;
        symbolInfo?: Record<string, unknown>;
    };
    defaultProps?: Record<string, InputValue>;
}
declare function analyze(script: Script, opts: AnalyzeOptions): AnalyzedScript;
/** Throw when a script declares a Pine version this engine does not accept. */
declare function assertSupportedVersion(script: Script): void;

/**
 * Strategy broker emulator.
 *
 * Models Pine's documented order lifecycle:
 *   - orders placed on bar N are filled on bar N+1 unless `process_orders_on_close=true`,
 *     in which case market orders fill at bar N's close;
 *   - market orders fill at the bar's open (plus slippage, always adverse);
 *   - stop/limit orders are working orders and fill when a later bar's range reaches them;
 *   - commission is charged per fill according to `commission_type`.
 *
 * Round trips are tracked FIFO so the host gets both a broker-state summary and the
 * per-fill markers a chart paints.
 */

type CommissionType = 'percent' | 'cash_per_contract' | 'cash_per_order';
type QtyType = 'fixed' | 'percent_of_equity' | 'cash' | 'shares';
interface BrokerOptions {
    initialCapital: number;
    commissionType: CommissionType;
    commissionValue: number;
    slippage: number;
    qtyType: QtyType;
    qtyValue: number;
    processOnClose: boolean;
    /** Pine's `pyramiding` limit: additional entries allowed per direction. */
    pyramiding?: number;
}
declare const DEFAULT_BROKER_OPTIONS: BrokerOptions;
interface OrderRequest {
    kind: 'entry' | 'close' | 'order';
    /** Signed direction for entries/orders: 1 buy, -1 sell. */
    direction: number;
    /** Order id as written by the script. */
    id: string;
    /** Absolute quantity; `null` means "size from default_qty_*" / "close the position". */
    qty: number | null;
    limit: number | null;
    stop: number | null;
    /**
     * `strategy.exit(profit, loss)` arms a bracket: the two levels are OCA, so whichever
     * the bar reaches first fills and cancels the other. Distinct from a stop-limit order
     * (`strategy.order(limit, stop)`), where the stop only *activates* the limit.
     */
    oco?: boolean;
    comment?: string;
    /** `strategy.exit` parameters. */
    fromEntry?: string;
    profitTicks?: number | null;
    lossTicks?: number | null;
    mintick: number;
    /** `strategy.close(..., qty_percent = …)` — close only part of the position. */
    qtyPercent?: number | null;
}
/** A `strategy.exit()` bracket with trailing parameters, evaluated bar by bar. */
interface TrailingExit {
    id: string;
    /** +1 for a long bracket, −1 for a short one. */
    direction: number;
    /** Activation profit in ticks (`trail_points`) or an absolute `trail_price`. */
    points: number | null;
    price: number | null;
    /** Distance kept behind the extreme, in ticks (`trail_offset`). */
    offset: number | null;
    tick: number;
    active: boolean;
    best: number | null;
    qty: number | null;
    qtyPercent: number | null;
    fromEntry?: string;
}
/**
 * A `strategy.exit(profit=…, loss=…)` bracket placed BEFORE its entry filled (the usual
 * `if crossover: entry + exit` shape). Pine prices the relative legs off the fill price,
 * so the bracket cannot be armed until the entry price is known — arming it earlier is
 * what turned it into a market order that closed the position at its own entry price.
 */
interface DeferredExit {
    id: string;
    /** −1 closes a long, +1 closes a short. */
    direction: number;
    fromEntry?: string;
    profitTicks: number | null;
    lossTicks: number | null;
    limitAbs: number | null;
    stopAbs: number | null;
    tick: number;
    qty: number | null;
    qtyPercent: number | null;
    comment?: string;
}
declare class Broker {
    readonly opts: BrokerOptions;
    private pending;
    private lots;
    position: number;
    avgPrice: number;
    realized: number;
    commissionPaid: number;
    grossProfit: number;
    grossLoss: number;
    wins: number;
    losses: number;
    even: number;
    maxDrawdown: number;
    maxRunup: number;
    private peakEquity;
    private troughEquity;
    equity: number;
    openPnl: number;
    lastClose: number;
    readonly fills: TradeExecution[];
    readonly closedTrades: StrategyTrade[];
    /**
     * Pine v6 keeps at most 9000 orders: anything older is trimmed away and its trade
     * records read as `na`. v5 instead aborted the whole run, which this engine never did,
     * so the cap is applied on the stored order/fill log for both versions.
     */
    orderCount: number;
    trimmedOrders: number;
    /** Number of closed trades dropped from the front of `closedTrades` by trimming. */
    trimmedTrades: number;
    /** Pine risk settings, set by the declaration and the `strategy.risk.*` calls. */
    pyramiding: number;
    maxPositionSize: number | null;
    allowedDirection: 'all' | 'long' | 'short';
    maxIntradayLoss: number | null;
    /** `strategy.risk.max_drawdown(value, type)`: halt when equity falls this far. */
    maxDrawdownLimit: number | null;
    maxDrawdownIsPercent: boolean;
    /** `strategy.risk.max_cons_loss_days(n)`: stop after n losing sessions in a row. */
    maxConsLossDays: number | null;
    /** `strategy.risk.max_intraday_filled_orders(n)`: cap fills per session. */
    maxIntradayFilledOrders: number | null;
    private dayStartEquity;
    private currentDay;
    private dayStartRealized;
    private losingDaysInARow;
    private fillsToday;
    /** Largest absolute position reached, per side (`strategy.max_contracts_held_*`). */
    maxContractsAll: number;
    maxContractsLong: number;
    maxContractsShort: number;
    private openTradeMeta;
    private tradeSeq;
    private orderSeq;
    constructor(opts?: Partial<BrokerOptions>);
    entry(req: Omit<OrderRequest, 'kind'>): void;
    order(req: Omit<OrderRequest, 'kind'>): void;
    /**
     * `strategy.close(entryId)` / `strategy.close_all()`: the argument names the *entry* the
     * call closes, while the resulting exit order carries its own label (`Close` / `Close All`).
     */
    close(entryId: string | null, comment?: string, qty?: number | null, qtyPercent?: number | null, label?: string): void;
    private trailing;
    /** Register (or replace) the trailing bracket created by `strategy.exit()`. */
    setTrailing(cfg: TrailingExit): void;
    clearTrailing(id?: string): void;
    private deferred;
    /**
     * Remember a `strategy.exit()` bracket whose relative levels cannot be priced yet
     * because its entry has not filled. `armDeferred` turns it into a working OCA order
     * the moment the entry fills, off the actual fill price.
     */
    deferExit(cfg: DeferredExit): void;
    /** Called after any entry fill: price the pending brackets off the new entry price. */
    private armDeferred;
    /** `strategy.cancel_all()` drops armed brackets along with the working orders. */
    clearDeferred(): void;
    /**
     * Evaluate the trailing brackets against a bar. Activation and the trailing stop are
     * tick based, like Pine's `trail_points` / `trail_offset`.
     */
    private checkTrailing;
    cancelAll(): void;
    /**
     * The newest pending entry, used by `strategy.exit()` when the bracket is placed on the
     * same bar as the entry (Pine evaluates the exit against the order, not the position).
     */
    pendingEntry(fromEntry?: string): {
        direction: number;
        qty: number;
    } | null;
    /** `strategy.cancel(id)` — drop the pending orders placed under that id. */
    cancel(id: string): void;
    private currentBar;
    /** Called when a new bar opens, before the script runs for it. */
    onBarOpen(bar: OHLCV, barIndex: number): void;
    /**
     * Called after the script ran for a bar. With `process_orders_on_close` market orders
     * placed this bar fill at this bar's close, which is what Pine's broker emulator does.
     */
    onBarClose(bar: OHLCV, barIndex: number): void;
    /**
     * Session bookkeeping: rolls the per-day counters over when the calendar day changes and
     * reports whether any `strategy.risk.*` rule currently forbids new entries.
     */
    private tradingHalted;
    private trackPositionExtremes;
    /** `strategy.position_entry_name` — the id of the entry that opened the position. */
    positionEntryName(): string | null;
    /** Notional margin required to hold the current position (1× leverage). */
    marginLiquidationPrice(): number | null;
    /** Strategy state summary at the current bar. */
    state(): StrategyState;
    trades(): StrategyTrade[];
    /** Track per-open-trade price extremes so `strategy.closedtrades.max_runup()` is real. */
    private updateExcursions;
    private markToMarket;
    private tryFill;
    private resolveQty;
    private commission;
    private execute;
    /**
     * Pine v6 keeps the 9000 most recent orders and trims the rest (v5 raised an error
     * instead). Trimming here drops the oldest fills and the closed trades those fills
     * finished, so `strategy.closedtrades.first_index` becomes `> 0`.
     */
    private trimOrders;
    private closeTrade;
}

/**
 * Drawing objects (`line`, `label`, `box`, `table`, `linefill`, `polyline`, `chart.point`).
 *
 * Pine's drawing API is mutable and handle-based: `line.new(...)` returns an id, the
 * `line.set_*` functions mutate that object, and the chart renders whatever is still
 * alive at the end of the run. This module keeps that state per object and converts it
 * into the host's renderer-neutral drawing vocabulary when the model is built.
 */

type DrawingKind = 'line' | 'label' | 'box' | 'table' | 'linefill' | 'polyline' | 'point';
interface LineObject {
    kind: 'line';
    id: string;
    xloc: DrawingXLoc;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    extend: DrawingExtend;
    color: string | null;
    width: number;
    style: 'solid' | 'dashed' | 'dotted';
    arrowLeft: boolean;
    arrowRight: boolean;
    deleted: boolean;
}
interface LabelObject {
    kind: 'label';
    id: string;
    xloc: DrawingXLoc;
    x: number;
    y: number;
    yloc: 'price' | 'abovebar' | 'belowbar';
    text: string;
    style: string;
    color: string | null;
    textColor: string | null;
    size: string;
    textAlign: string;
    tooltip: string | null;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    deleted: boolean;
}
interface BoxObject {
    kind: 'box';
    id: string;
    xloc: DrawingXLoc;
    left: number;
    top: number;
    right: number;
    bottom: number;
    extend: DrawingExtend;
    bgColor: string | null;
    borderColor: string | null;
    borderWidth: number;
    borderStyle: 'solid' | 'dashed' | 'dotted';
    text: string | null;
    textColor: string | null;
    textSize: string;
    hAlign: string;
    vAlign: string;
    wrap: boolean;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    deleted: boolean;
}
interface TableObject {
    kind: 'table';
    id: string;
    position: TablePosition;
    columns: number;
    rows: number;
    bgColor: string | null;
    frameColor: string | null;
    frameWidth: number;
    borderColor: string | null;
    borderWidth: number;
    cells: Array<Array<TableCell | null>>;
    merges: TableMerge[];
    deleted: boolean;
}
interface LinefillObject {
    kind: 'linefill';
    id: string;
    line1: string;
    line2: string;
    color: string | null;
    deleted: boolean;
}
interface PolylineObject {
    kind: 'polyline';
    id: string;
    points: PolylinePoint[];
    curved: boolean;
    closed: boolean;
    lineColor: string | null;
    fillColor: string | null;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'dotted';
    deleted: boolean;
}
interface PointObject {
    kind: 'point';
    id: string;
    time: number;
    index: number;
    price: number;
}
type DrawingObject = LineObject | LabelObject | BoxObject | TableObject | LinefillObject | PolylineObject | PointObject;
/** All drawing state of one script run. */
declare class DrawingStore {
    private nextId;
    readonly objects: Map<string, DrawingObject>;
    /** Insertion order per kind, so `.all` lists objects in creation order. */
    private readonly order;
    /** Create and register a drawing object; the caller narrows the returned record. */
    create<T = DrawingObject>(object: Record<string, unknown> & {
        kind: DrawingKind;
    }): T;
    get<T = DrawingObject>(id: string): T | undefined;
    delete(id: string): void;
    /** Live ids of one kind, in creation order. */
    ids(kind: DrawingKind): string[];
    live<T extends DrawingObject = DrawingObject>(kind: DrawingKind): T[];
    /** Convert one line object into the host vocabulary. */
    lineModel(obj: LineObject, paneId: string): DrawingLine;
    labelModel(obj: LabelObject, paneId: string): DrawingLabel;
    boxModel(obj: BoxObject, paneId: string): DrawingBox;
    tableModel(obj: TableObject, paneId: string): DrawingTable;
}

interface LinePlotRecord {
    callId: number;
    title: string;
    kind: 'line' | 'area' | 'step' | 'histogram' | 'columns' | 'circles' | 'cross';
    color: string;
    width: number;
    lineStyle: LineStyle;
    offset: number;
    base?: number;
    visible: boolean;
    values: Array<number | null>;
    colors: Array<string | null>;
}
interface MarkerRecord {
    callId: number;
    title: string;
    points: Array<MarkerPoint | null>;
}
interface HlineRecord {
    callId: number;
    title: string;
    price: number;
    color: string;
    lineStyle: LineStyle;
    width: number;
}
interface FillRecord {
    callId: number;
    /** Anchor plot call ids for a series band (absent for a price band). */
    fromId?: number;
    toId?: number;
    /** Anchor prices for a `fill(hline1, hline2, …)` band. */
    fromPrice?: number;
    toPrice?: number;
    title?: string;
    color: string;
    colors: Array<string | null>;
}
interface CandleRecord {
    callId: number;
    title: string;
    kind: 'candles' | 'bars';
    points: Array<TradeCandle | null>;
}
/** A candle slot; `time` is filled in when the model is built. */
interface TradeCandle {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    color: string | null;
    borderColor: string | null;
    wickColor: string | null;
}
interface BgRecord {
    callId: number;
    title: string;
    colors: Array<string | null>;
}
declare class PlotSink {
    readonly lines: Map<number, LinePlotRecord>;
    readonly markers: Map<number, MarkerRecord>;
    readonly hlines: Map<number, HlineRecord>;
    readonly fills: Map<number, FillRecord>;
    readonly backgrounds: Map<number, BgRecord>;
    readonly candles: Map<number, CandleRecord>;
    readonly barColors: Array<string | null>;
    ensureLine(callId: number, init: Omit<LinePlotRecord, 'values' | 'colors' | 'callId'>): LinePlotRecord;
    ensureMarkers(callId: number, title: string): MarkerRecord;
    ensureBackground(callId: number, title: string): BgRecord;
    ensureCandles(callId: number, title: string, kind: 'candles' | 'bars'): CandleRecord;
    ensureFill(callId: number, fromId: number, toId: number, color: string): FillRecord;
    /** `fill(hline1, hline2, color)` — a horizontal band between two constant prices. */
    ensureBandFill(callId: number, fromPrice: number, toPrice: number, color: string, title?: string): FillRecord;
}

/**
 * Time-series storage.
 *
 * Pine's central idea: every value-producing expression is a series indexed backwards
 * from the current bar (`close[1]` = previous bar's close). This module stores one
 * "slot" per variable: the value computed on the current bar plus the committed values
 * of the previous bars. `get(0)` is the current bar, `get(n)` the value n bars back.
 */

interface SeriesView {
    /** Value `offset` bars back; `offset === 0` is the current bar. na when unavailable. */
    get(offset: number): PineValue;
    /** Number of bars known to this view (current bar included). */
    readonly known: number;
}

/**
 * The script runtime: executes a parsed script bar by bar.
 *
 * Execution model (see docs/architecture.md):
 *   * one pass per bar, oldest first;
 *   * global-scope variables keep a `Slot` whose history is the series;
 *   * local scopes (if/for bodies, function bodies) are rebuilt every bar, except for
 *     `var`/`varip` declarations which persist;
 *   * builtins that hold state between bars key that state by *call site*, so two
 *     `ta.ema()` calls never share an accumulator.
 */

interface DeclarationInfo {
    title: string;
    shorttitle?: string;
    overlay: boolean;
    precision?: number;
    format?: string;
    isStrategy: boolean;
    broker: Partial<BrokerOptions>;
}
interface RuntimeConfig {
    script: Script;
    bars: OHLCV[];
    market: ExecutionMarket;
    declaration: DeclarationInfo;
    /** Input overrides keyed by input key. */
    inputs: Record<string, InputValue>;
    /** Call-site id -> input key, produced by the static analysis pass. */
    inputKeys: Map<number, string>;
    /** Declaration prop overrides. */
    props: Record<string, InputValue>;
    /** Resolved library sources: alias -> parsed statements. */
    libraries: Map<string, Stmt[]>;
    /** Pre-fetched secondary series for `request.security`, keyed by `symbol|timeframe`. */
    securityData: Map<string, OHLCV[]>;
    maxBarsBack?: number;
}
interface RunResult {
    sink: PlotSink;
    broker: Broker | null;
    globals: Map<string, PineValue>;
    barIndex: number;
}
declare class Runtime {
    readonly script: Script;
    readonly bars: OHLCV[];
    readonly market: ExecutionMarket;
    readonly declaration: DeclarationInfo;
    readonly sink: PlotSink;
    /** Drawing objects created by this run (`line`, `label`, `box`, `table`, …). */
    readonly drawings: DrawingStore;
    readonly pendingAlerts: EngineAlert[];
    readonly broker: Broker | null;
    readonly warnings: EngineWarning[];
    barIndex: number;
    private readonly frames;
    private scopePath;
    private readonly callStates;
    private readonly exprHistory;
    private readonly nodeIds;
    private nextNodeId;
    /** Per-library member tables, so a library's body sees its own names. */
    private readonly libraryFunctions;
    private readonly libraryMethods;
    /** `method`s a library declares `export`, callable by the importing script. */
    private readonly libraryExportedMethods;
    private readonly libraryEnums;
    private readonly libraryTypes;
    /** Alias of the library whose function is currently executing, if any. */
    private readonly libraryStack;
    private readonly functions;
    /** `type` declarations: UDT name → field list (in declaration order). */
    private readonly userTypes;
    /** `enum` declarations: enum name → member map. */
    private readonly enums;
    /** `method` declarations, keyed by method name (they share one namespace in Pine). */
    private readonly methods;
    private readonly namespaces;
    private callDepth;
    private readonly config;
    private readonly firstBarCache;
    constructor(config: RuntimeConfig);
    /** Declared Pine version (1–6); a script without an annotation is v1. */
    get version(): number;
    /**
     * Pine v1/v2 allowed a variable to reference itself or a later declaration
     * (`s = nz(s[1]) + close`); v3 removed both, because a name must be declared before it
     * is read. Pre-declaring every top-level assignment target reproduces the v1/v2 rule
     * without weakening v3+ (their scripts never rely on it, and a genuinely undeclared
     * name still errors).
     */
    private hoistLegacyLocals;
    /**
     * v6 semantics. The differences that matter at runtime are documented in the official
     * migration guide: strict `bool` conditions, lazy `and`/`or`, fractional `const int`
     * division, dynamic `request.*()`, negative array indices and a live loop boundary.
     */
    get isV6(): boolean;
    /**
     * Evaluate a condition. Pine v6 forbids implicitly casting `int`/`float` to `bool`
     * (`if 1` is a compile error); v5 and older accept any value through truthiness.
     */
    private cond;
    private collectFunctions;
    /** `enum Name` → a namespace whose members are strings (or the declared constants). */
    private defineEnum;
    /** Evaluate an enum's members into name → value. */
    private enumValues;
    /** Build a user-defined-type instance, filling fields positionally or by name. */
    private constructUserType;
    private seedBuiltinSlots;
    private globalFrame;
    /** Absolute scope path for a child segment of the current scope. */
    private childPath;
    private currentFrame;
    run(): RunResult;
    /** Execute one bar, returning the value of the last top-level expression. */
    step(index: number): PineValue;
    private endBar;
    private seedBarSeries;
    private execBlock;
    private execScoped;
    execStmt(stmt: Stmt): PineValue;
    private execSwitch;
    private switchMatches;
    private execCase;
    private execFor;
    /**
     * `while <cond>` loop. Pine caps loop execution (there is no `for`-style bound to
     * enforce), so the engine raises after `LOOP_LIMIT` iterations instead of hanging.
     */
    private execWhile;
    private execForIn;
    private execAssign;
    private assignTargets;
    private writeIdent;
    private readTarget;
    evalExpr(expr: Expr): PineValue;
    private evalBinary;
    /** `and`/`or` operand: v6 requires a real boolean, v5 accepts anything truthy. */
    private boolOperand;
    /**
     * v1/v2 convert `true`/`false` to `1`/`0` in arithmetic; v3 forbade it ("Cannot call
     * `operator +` with arguments (series__bool, series__bool)") and v6 kept the refusal.
     */
    private arithmeticOperand;
    binary(op: string, left: PineValue, right: PineValue, line: number): PineValue;
    private lookupIdent;
    /** Resolve a legacy name that maps onto a v5 namespace member (`color.red`, `ta.tr`, …). */
    private resolveLegacyIdent;
    private evalMember;
    /** Resolve an object value to a member (used by `resolveMember`). */
    evalObject(expr: Expr): PineValue;
    private nodeKey;
    /** Obtain a series view for an expression, recording per-bar values when necessary. */
    seriesOf(expr: Expr): SeriesView;
    private findSlot;
    private evalCall;
    /** The alias of the library whose body is currently executing. */
    private currentLibrary;
    /** A library's own (exported or private) function, looked up by bare name. */
    private libraryOwnFunction;
    /** A `method` declared in the library whose body is executing. */
    private libraryMethod;
    private callSite;
    /**
     * Arguments Pine removed in v5/v6 are a compile error, not silently ignored. Only the
     * removals with a documented replacement are listed; a general unknown-argument check
     * needs a full signature table for every builtin (see `docs/known-limitations.md`).
     */
    private rejectRemovedArgs;
    /** Internal: per-call-site persistent state (see `CallSite.state`). */
    callState<T>(key: string, init: () => T): T;
    warn(method: string, message: string): void;
    private callUserFunction;
    /** Invoke a lambda value with already-evaluated arguments (used by `array.every`…). */
    callLambdaValue(fn: PineValue, values: PineValue[], line: number): PineValue;
    private callLambda;
    get bar(): OHLCV | undefined;
    /** Bar interval in milliseconds, inferred from the data. */
    barDurationMs(): number;
    /** The bar currently executing (alias kept for the drawing builtins). */
    get currentBar(): OHLCV | undefined;
    get inputOverrides(): Record<string, InputValue>;
    get propOverrides(): Record<string, InputValue>;
    inputKeyFor(callId: number): string | undefined;
    get securityData(): Map<string, OHLCV[]>;
    get maxBarsBack(): number | undefined;
    /** Bar index of the oldest bar in this run (always 0 for a full pass). */
    get firstIndex(): number;
    firstBar<T>(key: number, init: () => T): T;
    getBarAt(index: number): OHLCV | undefined;
    /** Series view for a named variable (builtin or script variable). */
    seriesByName(name: string): SeriesView;
    /** Value of a named variable on the current bar (na when unknown). */
    valueByName(name: string): PineValue;
    /** Current bar index within this run (0-based). */
    get index(): number;
    /** The full bar array of this run. */
    get allBars(): OHLCV[];
    /** All input override values (keyed by input key). */
    get inputs(): Record<string, InputValue>;
    private readonly securityRuns;
    /**
     * Evaluate a `request.security` expression in a secondary context bound to another
     * symbol/timeframe, then align it to the chart's bars.
     */
    /**
     * `request.security_lower_tf`: every lower-timeframe value inside the current bar's
     * window, as a Pine array. Uses the same host-prefetched series as `request.security`.
     */
    lowerTfValues(callId: number, symbol: string, timeframe: string, expr: Expr): PineValue;
    switchContext(callId: number, symbol: string, timeframe: string, expr: Expr, lookahead: boolean): PineValue;
    /** Declaration info (indicator()/strategy() arguments). */
    get decl(): DeclarationInfo;
}

/** Parsed import path: `import user/library/version as alias`. */
interface PineLibraryImport {
    user: string;
    name: string;
    version: string;
}
/**
 * Returns a library's Pine source for its import path, or `null` for a library the host
 * does not provide. Called during `prepare()` for every import (and the transitive imports
 * of the libraries it returns).
 */
type PineLibraryResolver = (path: string, info: PineLibraryImport) => Promise<string | null> | string | null;
/** Which declaration properties an engine publishes. */
type PropsVisibility = 'all' | 'strategy' | 'none' | ReadonlyArray<string>;
interface PineEngineOptions {
    /** Host-level defaults for declaration props the script does not declare itself. */
    defaultProps?: Record<string, InputValue>;
    /** Which scripts publish a property schema (default `'all'`). */
    props?: PropsVisibility;
    /** Resolver for `import`ed Pine libraries. */
    importResolver?: PineLibraryResolver;
    /** Guard against pathological datasets (default: no limit). */
    maxBars?: number;
}

interface PreparedToken {
    source: string;
    instanceId: string;
    analyzed: AnalyzedScript;
    libraries: Map<string, Stmt[]>;
}
declare class PineEngine implements ScriptingEngine {
    readonly language = "pine";
    readonly capabilities: EngineCapabilities;
    private readonly options;
    constructor(options?: PineEngineOptions);
    prepare(source: string, instanceId: string): Promise<PreparedScript>;
    private visibleProps;
    private resolveImports;
    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession;
    /** Internal: run one full pass and return the model. */
    runOnce(token: PreparedToken, req: ExecutionRequest, inputs: Record<string, InputValue>, props: Record<string, InputValue>): Promise<{
        model: IndicatorModel;
        snapshot: EngineContextSnapshot;
        state: {
            runtime: Runtime;
            model: IndicatorModel;
        };
        alerts: ReturnType<typeof collectAlerts>;
        warnings: Array<{
            message: string;
            method?: string;
            bar: number;
        }>;
    }>;
}
declare function collectAlerts(runtime: Runtime): EngineAlert[];
declare function normalizeError(err: unknown): Error;

/** Worker ABI shared by `PineWorkerEngine` (main thread) and the worker entry. */

interface PrepareMessage {
    type: 'prepare';
    /** Main-thread key the prepared script is stored under inside the worker. */
    key: string;
    source: string;
    instanceId: string;
}
interface ExecuteMessage {
    type: 'execute';
    key: string;
    sessionId: string;
    request: {
        market: ExecutionMarket;
        bars: OHLCV[];
        inputs: Record<string, InputValue>;
        props: Record<string, InputValue>;
        mode: 'static' | 'live';
        historyState?: 'backfill' | 'complete';
        visibleRange?: VisibleBarRange;
        /** True when the host can serve secondary series (request.security). */
        canFetch: boolean;
    };
}
interface UpdateMessage {
    type: 'update';
    sessionId: string;
    inputs: Record<string, InputValue>;
    props?: Record<string, InputValue>;
}
interface NotifyMessage {
    type: 'notifyBars';
    sessionId: string;
    reason?: 'backfill' | 'complete';
}
interface StopMessage {
    type: 'stop';
    sessionId: string;
}
interface ContextMessage {
    type: 'context';
    sessionId: string;
    requestId: string;
    select?: ContextSelect;
}
interface DisposeMessage {
    type: 'dispose';
}
type ToWorkerMessage = PrepareMessage | ExecuteMessage | UpdateMessage | NotifyMessage | StopMessage | ContextMessage | DisposeMessage
/** Reply to a `fetchSeriesRequest`. */
 | {
    type: 'fetchSeriesResult';
    requestId: string;
    bars: OHLCV[];
    error?: string;
};
interface PreparedReply {
    type: 'prepared';
    key: string;
    inputs: InputSchema[];
    props?: InputSchema[];
    meta: IndicatorMeta;
    reactsToViewport: boolean;
    warnings: string[];
}
type FromWorkerMessage = PreparedReply | {
    type: 'model';
    sessionId: string;
    model: IndicatorModel;
} | {
    type: 'alert';
    sessionId: string;
    alert: EngineAlert;
} | {
    type: 'warning';
    sessionId: string;
    warning: EngineWarning;
} | {
    type: 'done';
    sessionId: string;
} | {
    type: 'error';
    sessionId?: string;
    key?: string;
    message: string;
    name?: string;
} | {
    type: 'context';
    sessionId: string;
    requestId: string;
    snapshot: EngineContextSnapshot | null;
} | {
    type: 'fetchSeriesRequest';
    requestId: string;
    symbol: string;
    timeframe: string;
    range: BarRange;
};

/**
 * `PineWorkerEngine` — the same Pine semantics as `PineEngine`, executed off the main
 * thread.
 *
 * The worker source ships as its own entry (`vela-pine-libre/worker`). By default the
 * engine spawns it with `new Worker(new URL('./worker.js', import.meta.url), { type:
 * 'module' })`; hosts under a strict CSP can pass `workerUrl`, and tests can inject a
 * `workerFactory`.
 */

interface WorkerLike {
    postMessage(message: ToWorkerMessage): void;
    onmessage: ((event: {
        data: FromWorkerMessage;
    }) => void) | null;
    addEventListener?(type: 'message', listener: (event: {
        data: FromWorkerMessage;
    }) => void): void;
    terminate?(): void;
}
interface PineWorkerOptions extends PineEngineOptions {
    /** URL of the worker bundle; defaults to the module-relative `worker.js`. */
    workerUrl?: string | URL;
    /** Creates the worker; overrides `workerUrl` (used by hosts and tests). */
    workerFactory?: () => WorkerLike;
}
declare class PineWorkerEngine implements ScriptingEngine {
    private readonly options;
    readonly language = "pine";
    readonly capabilities: EngineCapabilities;
    private worker;
    private readonly pendingPrepares;
    private readonly sessions;
    private keySeq;
    private sessionSeq;
    private contextSeq;
    private disposed;
    constructor(options?: PineWorkerOptions);
    private ensureWorker;
    private onMessage;
    private send;
    prepare(source: string, instanceId: string): Promise<PreparedScript>;
    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession;
    /** Terminate the worker and reject anything in flight. */
    dispose(): void;
}

/**
 * The Web Worker entry point.
 *
 * `installWorker(scope)` wires the engine to any object that can `postMessage` and receive
 * messages — the real `DedicatedWorkerGlobalScope` in a browser, or an in-process fake in
 * tests. The module self-installs when loaded inside a worker.
 */

interface WorkerScope {
    postMessage(message: FromWorkerMessage): void;
    onmessage: ((event: {
        data: ToWorkerMessage;
    }) => void) | null;
    addEventListener?(type: 'message', listener: (event: {
        data: ToWorkerMessage;
    }) => void): void;
}
interface WorkerHandler {
    handle(message: ToWorkerMessage): void;
    dispose(): void;
}
declare function createWorkerHandler(scope: WorkerScope): WorkerHandler;
/** Attach to a worker global scope when this module is loaded inside one. */
declare function installWorker(scope: WorkerScope): WorkerHandler;

/**
 * Recursive-descent parser for the supported Pine subset.
 *
 * The grammar implemented here follows the publicly documented Pine Script v5/v6
 * language reference: statement-per-line, indentation-delimited blocks, the documented
 * operator table, `var`/`varip` declarations, user-defined functions declared with
 * `name(params) =>`, and the `if`/`switch`/`for` control-flow statements.
 *
 * Unsupported constructs are rejected with an explicit `PineSyntaxError` carrying
 * `code: 'UNSUPPORTED'`, never silently ignored.
 */

/** Test hook: reset the call-site id counter so parse output is deterministic. */
declare function resetCallIds(): void;
declare function parseScript(source: string): Script;
declare function detectVersion(source: string): number | null;

/**
 * Token definitions for the Pine source front end.
 *
 * Independent implementation: the token vocabulary below was derived from the public
 * Pine Script v5/v6 language reference (operators, literals, keyword list), not from any
 * existing parser implementation.
 */
type TokenType = 'num' | 'str' | 'ident' | 'op' | 'newline' | 'eof';
interface Token {
    type: TokenType;
    /** Raw lexeme (for `num` this is the source text, for `op` the operator). */
    value: string;
    /** Decoded numeric value for `num` tokens. */
    num?: number;
    /** 1-based source line. */
    line: number;
    /** 1-based column. */
    col: number;
    /**
     * For `newline` tokens: the indentation (in columns) of the *next* logical line.
     * `-1` for the final newline before EOF.
     */
    indent: number;
    /** Indentation of the line this token starts on (filled in after lexing). */
    lineIndent?: number;
}
declare class PineSyntaxError extends Error {
    readonly line: number;
    readonly col: number;
    readonly code: string;
    constructor(message: string, line: number, col: number, code?: string);
}

/**
 * Pine source lexer.
 *
 * Design notes (independent implementation):
 *  - Pine is line oriented and indentation structured. The lexer emits a single
 *    `newline` token between logical lines and records the indentation of the line that
 *    follows it, so the parser can decide between "next statement" and "deeper block".
 *  - Inside brackets (`(`, `[`) newlines are insignificant and are therefore dropped;
 *    this reproduces Pine's rule that an expression may wrap inside parentheses.
 *  - `//` starts a comment that runs to end of line.
 *  - String literals are single or double quoted with backslash escapes.
 */

declare function tokenize(source: string): Token[];

/** Errors raised while executing a script. */
type PineRuntimeErrorCode = 'UNDECLARED_VARIABLE' | 'TYPE_ERROR' | 'INVALID_ARGUMENT' | 'UNKNOWN_FUNCTION' | 'UNSUPPORTED_FEATURE' | 'HISTORY_OUT_OF_RANGE' | 'DIVISION_BY_ZERO' | 'SCRIPT_ERROR' | 'IMPORT_ERROR' | 'EXECUTION_TIMEOUT';
declare class PineRuntimeError extends Error {
    readonly code: PineRuntimeErrorCode;
    readonly line?: number;
    readonly col?: number;
    readonly bar?: number;
    constructor(message: string, code?: PineRuntimeErrorCode, info?: {
        line?: number;
        col?: number;
        bar?: number;
    });
    /** Human-readable one-liner used in engine diagnostics. */
    describe(): string;
}

/** Builtin registry assembly. */

/** Every registered builtin name — used by the compatibility documentation and tests. */
declare function builtinNames(): string[];

export { type AnalyzedScript, type Background, type BarRange, type BarsChangeReason, Broker, type BrokerOptions, COLOR_NAMES, type CandlePoint, type CandleSeries, type CommissionType, type ContextSelect, DEFAULT_BROKER_OPTIONS, type DeclarationInfo, type DrawingBox, type DrawingExtend, type DrawingLabel, type DrawingLine, type DrawingLinefill, type DrawingPolyline, type DrawingTable, type DrawingXLoc, type EngineAlert, type EngineCapabilities, type EngineContextSnapshot, type EngineWarning, type ExecutionHandlers, type ExecutionMarket, type ExecutionRequest, type ExecutionSession, type Expr, type FetchSeries, type Fill, type FontFamily, type HAlign, INDICATOR_PROP_SPECS, type IndicatorMeta, type IndicatorModel, type InputSchema, type InputType, type InputValue, type LabelStyleName, type LineLikeKind, type LineLikeSeries, type LineLikeStyle, type LineStyle, type MarkerPoint, type MarkerSeries, type Millis, type OHLCV, PineArray, PineColor, PineEngine, type PineEngineOptions, type PineLibraryImport, type PineLibraryResolver, PineRuntimeError, PineSyntaxError, PineWorkerEngine, type PineWorkerOptions, type PolylinePoint, type PreparedScript, type PreparedToken, type PriceLine, type PropsVisibility, type QtyType, type RunResult, Runtime, type RuntimeConfig, STRATEGY_PROP_SPECS, type Script, type ScriptingEngine, type SecurityRequest, type SeriesBase, type SeriesPoint, type SeriesSpec, type Stmt, type StrategyFill, type StrategyState, type StrategyTrade, type SymbolInfo, type TableCell, type TableMerge, type TablePosition, type TextSizeName, type TradeExecution, type VAlign, type VisibleBarRange, type WorkerHandler, type WorkerLike, type WorkerScope, analyze, assertSupportedVersion, builtinNames, createWorkerHandler, detectVersion, installWorker, normalizeError, parseScript, resetCallIds, tokenize };
