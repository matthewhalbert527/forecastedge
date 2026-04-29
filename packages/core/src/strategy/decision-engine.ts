export const strategyApprovalStatuses = [
  "Draft",
  "Backtest Passed",
  "Walk-Forward Passed",
  "Paper Testing",
  "Paper Approved",
  "Rejected"
] as const;

export type StrategyApprovalStatus = (typeof strategyApprovalStatuses)[number];
export type StrategyValidationMode = "backtest" | "walk_forward" | "paper";
export type StrategyWarningSeverity = "info" | "warning" | "critical";

export interface StrategyApprovalThresholds {
  minTrades: number;
  minTestPeriodRoi: number;
  maxDrawdown: number;
  minWinRate: number;
  minExpectancy: number;
  minLiquidityScore: number;
  maxLosingStreak: number;
  maxSingleTradePnlShare: number;
  maxRiskOfRuin: number;
  minDataQualityScore: number;
  maxOutlierAdjustedReturnDrop: number;
  minPaperTrades: number;
  maxPaperSlippageDegradation: number;
  maxPaperWinRateDegradation: number;
  maxPaperPnlDegradation: number;
}

export const defaultStrategyApprovalThresholds: StrategyApprovalThresholds = {
  minTrades: 30,
  minTestPeriodRoi: 0,
  maxDrawdown: 25,
  minWinRate: 0.48,
  minExpectancy: 0,
  minLiquidityScore: 0.05,
  maxLosingStreak: 6,
  maxSingleTradePnlShare: 0.35,
  maxRiskOfRuin: 0.25,
  minDataQualityScore: 70,
  maxOutlierAdjustedReturnDrop: 0.5,
  minPaperTrades: 20,
  maxPaperSlippageDegradation: 0.03,
  maxPaperWinRateDegradation: 0.12,
  maxPaperPnlDegradation: 0.5
};

export interface StrategyTradeResult {
  marketTicker: string;
  observedAt: string;
  pnl: number;
  cost: number;
  payout: number;
  roi: number;
  contracts: number;
  entryPrice: number;
  rawEntryPrice: number;
  liquidityScore: number | null;
  city: string | null;
  variable: string | null;
  targetDate: string | null;
  eventKey: string | null;
}

export interface ExpectancyMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalCost: number;
  totalPayout: number;
  totalPnl: number;
  roi: number;
  expectedValuePerTrade: number;
  averageWin: number;
  averageLoss: number;
  payoffRatio: number | null;
  breakEvenWinRate: number | null;
  profitFactor: number | null;
  riskOfRuin: number;
  medianTradeReturn: number;
  outlierAdjustedReturn: number;
  outlierAdjustedReturnDrop: number;
  maxDrawdown: number;
  longestLosingStreak: number;
  averageLiquidityScore: number | null;
  singleTradePnlShare: number;
  rareLongShotWin: boolean;
}

export interface DataQualityInput {
  totalMarkets: number;
  missingMarketPrices: number;
  missingForecastSnapshots: number;
  staleForecasts: number;
  settlementAmbiguities: number;
  lowLiquidityMarkets: number;
  suspiciousPriceGaps: number;
  duplicateMarketRows: number;
  incompleteMarketHistories: number;
  latestMarketDataAt: string | null;
  latestForecastAt: string | null;
}

export interface DataQualityScore {
  score: number;
  reliability: "good" | "warning" | "unreliable";
  warnings: string[];
  details: DataQualityInput;
}

export interface StrategyWarning {
  code: string;
  severity: StrategyWarningSeverity;
  message: string;
}

export interface AntiOverfittingReport {
  warnings: StrategyWarning[];
  parameterFragility: "low" | "medium" | "high";
  concentration: {
    topCityShare: number;
    topDateShare: number;
    topEventPnlShare: number;
  };
  feeSensitivity: {
    rawRoi: number | null;
    feeAdjustedRoi: number | null;
    collapsePct: number | null;
  };
}

export interface AntiOverfittingInput {
  trades: StrategyTradeResult[];
  candidateSnapshots: number;
  eligibleSnapshots: number;
  parameters: Record<string, unknown>;
  thresholds?: StrategyApprovalThresholds;
}

export interface PaperValidationTrade {
  orderId: string;
  marketTicker: string;
  expectedEntryPrice: number | null;
  actualFillPrice: number | null;
  expectedSlippage: number | null;
  actualSlippage: number | null;
  expectedPnl: number | null;
  actualPnl: number | null;
  expectedWinProbability: number | null;
  status: "open" | "won" | "lost" | "rejected" | "skipped";
  skippedReason: string | null;
  signalGenerated: boolean;
  filled: boolean;
  edgeDisappeared: boolean;
  openedAt: string;
}

export interface PaperValidationSummary {
  paperTrades: number;
  settledPaperTrades: number;
  expectedEntryPrice: number | null;
  actualFillPrice: number | null;
  expectedSlippage: number | null;
  actualSlippage: number | null;
  expectedWinRate: number | null;
  observedWinRate: number | null;
  expectedPnlPerTrade: number | null;
  observedPnlPerTrade: number | null;
  skippedTrades: number;
  signalNoFill: number;
  fillEdgeDisappeared: number;
  liveEdgeDegraded: boolean;
  warnings: StrategyWarning[];
}

export interface ApprovalGateResult {
  name: string;
  passed: boolean;
  actual: number | string | null;
  threshold: number | string;
  reason: string;
}

export interface StrategyRecommendationExplanation {
  summary: string;
  edge: string;
  performsBest: string;
  failsWhen: string;
  liquidityConditions: string;
  riskLimits: string;
  paperOnly: boolean;
}

export interface StrategyApprovalDecision {
  status: StrategyApprovalStatus;
  validationMode: StrategyValidationMode;
  approvedForRecommendation: boolean;
  gates: ApprovalGateResult[];
  warnings: StrategyWarning[];
  explanation: StrategyRecommendationExplanation;
}

export function calculateExpectancyMetrics(
  trades: StrategyTradeResult[],
  thresholds: StrategyApprovalThresholds = defaultStrategyApprovalThresholds
): ExpectancyMetrics {
  const wins = trades.filter((trade) => trade.pnl > 0);
  const losses = trades.filter((trade) => trade.pnl < 0);
  const totalCost = sum(trades.map((trade) => trade.cost));
  const totalPayout = sum(trades.map((trade) => trade.payout));
  const totalPnl = sum(trades.map((trade) => trade.pnl));
  const averageWin = average(wins.map((trade) => trade.pnl)) ?? 0;
  const averageLoss = Math.abs(average(losses.map((trade) => trade.pnl)) ?? 0);
  const grossWins = sum(wins.map((trade) => trade.pnl));
  const grossLosses = Math.abs(sum(losses.map((trade) => trade.pnl)));
  const payoffRatio = averageLoss > 0 ? round(averageWin / averageLoss) : averageWin > 0 ? null : 0;
  const breakEvenWinRate = averageWin + averageLoss > 0 ? round(averageLoss / (averageWin + averageLoss)) : null;
  const profitFactor = grossLosses > 0 ? round(grossWins / grossLosses) : grossWins > 0 ? null : 0;
  const returns = trades.map((trade) => trade.cost > 0 ? trade.pnl / trade.cost : 0);
  const outlierAdjustedReturn = calculateOutlierAdjustedReturn(trades);
  const roi = totalCost > 0 ? totalPnl / totalCost : 0;
  const outlierAdjustedReturnDrop = roi > 0 ? Math.max(0, (roi - outlierAdjustedReturn) / roi) : 0;
  const singleTradePnlShare = calculateSingleTradePnlShare(trades);
  const riskOfRuin = estimateRiskOfRuin({
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    expectedValuePerTrade: trades.length > 0 ? totalPnl / trades.length : 0,
    payoffRatio: payoffRatio ?? 10,
    breakEvenWinRate
  });
  const equity = buildEquityStats(trades);
  const averageLiquidityScore = average(trades.map((trade) => trade.liquidityScore));
  const rareLongShotWin = singleTradePnlShare > thresholds.maxSingleTradePnlShare || outlierAdjustedReturnDrop > thresholds.maxOutlierAdjustedReturnDrop;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? round(wins.length / trades.length) : 0,
    totalCost: round(totalCost),
    totalPayout: round(totalPayout),
    totalPnl: round(totalPnl),
    roi: round(roi),
    expectedValuePerTrade: trades.length > 0 ? round(totalPnl / trades.length) : 0,
    averageWin: round(averageWin),
    averageLoss: round(averageLoss),
    payoffRatio,
    breakEvenWinRate,
    profitFactor,
    riskOfRuin,
    medianTradeReturn: round(median(returns)),
    outlierAdjustedReturn: round(outlierAdjustedReturn),
    outlierAdjustedReturnDrop: round(outlierAdjustedReturnDrop),
    maxDrawdown: equity.maxDrawdown,
    longestLosingStreak: equity.longestLosingStreak,
    averageLiquidityScore: averageLiquidityScore === null ? null : round(averageLiquidityScore),
    singleTradePnlShare: round(singleTradePnlShare),
    rareLongShotWin
  };
}

export function scoreDataQuality(input: DataQualityInput): DataQualityScore {
  const denominator = Math.max(1, input.totalMarkets);
  const weightedIssues = [
    { count: input.missingMarketPrices, weight: 26, label: "missing market prices" },
    { count: input.missingForecastSnapshots, weight: 22, label: "missing forecast snapshots" },
    { count: input.staleForecasts, weight: 16, label: "stale forecasts" },
    { count: input.settlementAmbiguities, weight: 18, label: "settlement ambiguity" },
    { count: input.lowLiquidityMarkets, weight: 14, label: "low-liquidity markets" },
    { count: input.suspiciousPriceGaps, weight: 12, label: "suspicious price gaps" },
    { count: input.duplicateMarketRows, weight: 10, label: "duplicate candles/trades" },
    { count: input.incompleteMarketHistories, weight: 16, label: "incomplete market history" }
  ];
  let score = 100;
  const warnings: string[] = [];
  for (const issue of weightedIssues) {
    if (issue.count <= 0) continue;
    score -= Math.min(issue.weight, issue.weight * issue.count / denominator);
    warnings.push(`${issue.count} ${issue.label}`);
  }
  if (input.totalMarkets === 0) {
    score = 0;
    warnings.push("no markets available for validation");
  }
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: rounded,
    reliability: rounded >= 85 ? "good" : rounded >= 70 ? "warning" : "unreliable",
    warnings,
    details: input
  };
}

export function detectAntiOverfitting(input: AntiOverfittingInput): AntiOverfittingReport {
  const thresholds = input.thresholds ?? defaultStrategyApprovalThresholds;
  const trades = input.trades;
  const warnings: StrategyWarning[] = [];
  const topCityShare = largestGroupShare(trades, (trade) => trade.city ?? "unknown");
  const topDateShare = largestGroupShare(trades, (trade) => trade.targetDate ?? trade.observedAt.slice(0, 10));
  const topEventPnlShare = largestPositivePnlGroupShare(trades, (trade) => trade.eventKey ?? trade.marketTicker);
  const activeFilters = ["minEdge", "maxEntryPrice", "minLiquidityScore", "maxSpread", "startDate", "endDate"]
    .filter((key) => input.parameters[key] !== null && input.parameters[key] !== undefined && input.parameters[key] !== "").length;
  const filteredShare = input.candidateSnapshots > 0 ? input.eligibleSnapshots / input.candidateSnapshots : 0;
  const feeSensitivity = feeSensitivityReport(trades);

  if (activeFilters >= 4 || Number(input.parameters.minEdge ?? 0) >= 0.12 || Number(input.parameters.maxSpread ?? 1) <= 0.04) {
    warnings.push({
      code: "narrow_parameters",
      severity: "warning",
      message: "Optimized settings are narrow; verify nearby edge, price, liquidity, and spread values before promotion."
    });
  }
  if (filteredShare > 0 && filteredShare < 0.1 && input.candidateSnapshots >= thresholds.minTrades * 3) {
    warnings.push({
      code: "nearby_parameter_fragility",
      severity: "critical",
      message: "Only a small parameter neighborhood survives filtering, which suggests parameter fragility."
    });
  }
  if (topCityShare >= 0.75 && trades.length >= thresholds.minTrades) {
    warnings.push({
      code: "single_city_dependency",
      severity: "warning",
      message: "Most trades come from one city; validate the edge across other settlement stations."
    });
  }
  if (topDateShare >= 0.4 && trades.length >= thresholds.minTrades) {
    warnings.push({
      code: "date_range_dependency",
      severity: "warning",
      message: "A large share of trades comes from one date, so the result may not generalize."
    });
  }
  if (topEventPnlShare > thresholds.maxSingleTradePnlShare) {
    warnings.push({
      code: "weather_event_concentration",
      severity: "critical",
      message: "Most profit comes from one market or weather event."
    });
  }
  if (feeSensitivity.collapsePct !== null && feeSensitivity.collapsePct >= 0.5) {
    warnings.push({
      code: "fee_slippage_collapse",
      severity: "critical",
      message: "Performance collapses after execution costs and slippage."
    });
  }
  if (trades.length < thresholds.minTrades) {
    warnings.push({
      code: "too_few_test_trades",
      severity: "critical",
      message: "Test period has too few trades for approval."
    });
  }

  return {
    warnings,
    parameterFragility: warnings.some((warning) => warning.severity === "critical")
      ? "high"
      : warnings.length > 0
        ? "medium"
        : "low",
    concentration: {
      topCityShare: round(topCityShare),
      topDateShare: round(topDateShare),
      topEventPnlShare: round(topEventPnlShare)
    },
    feeSensitivity
  };
}

export function summarizePaperValidation(
  trades: PaperValidationTrade[],
  expectedMetrics: Pick<ExpectancyMetrics, "winRate" | "expectedValuePerTrade">,
  thresholds: StrategyApprovalThresholds = defaultStrategyApprovalThresholds
): PaperValidationSummary {
  const settled = trades.filter((trade) => trade.status === "won" || trade.status === "lost");
  const filled = trades.filter((trade) => trade.filled && trade.actualFillPrice !== null);
  const expectedEntryPrice = average(filled.map((trade) => trade.expectedEntryPrice));
  const actualFillPrice = average(filled.map((trade) => trade.actualFillPrice));
  const expectedSlippage = average(filled.map((trade) => trade.expectedSlippage));
  const actualSlippage = average(filled.map((trade) => trade.actualSlippage));
  const expectedPnlPerTrade = average(trades.map((trade) => trade.expectedPnl)) ?? expectedMetrics.expectedValuePerTrade;
  const observedPnlPerTrade = average(settled.map((trade) => trade.actualPnl));
  const observedWinRate = settled.length > 0 ? settled.filter((trade) => trade.status === "won").length / settled.length : null;
  const warnings: StrategyWarning[] = [];
  const slippageDegraded = expectedSlippage !== null && actualSlippage !== null && actualSlippage - expectedSlippage > thresholds.maxPaperSlippageDegradation;
  const winRateDegraded = observedWinRate !== null && expectedMetrics.winRate - observedWinRate > thresholds.maxPaperWinRateDegradation;
  const pnlDegraded = observedPnlPerTrade !== null && expectedPnlPerTrade !== null && expectedPnlPerTrade > 0 && observedPnlPerTrade < expectedPnlPerTrade * (1 - thresholds.maxPaperPnlDegradation);
  const signalNoFill = trades.filter((trade) => trade.signalGenerated && !trade.filled).length;
  const fillEdgeDisappeared = trades.filter((trade) => trade.edgeDisappeared).length;

  if (trades.length < thresholds.minPaperTrades) {
    warnings.push({ code: "paper_sample_small", severity: "warning", message: "Paper sample is not large enough for approval." });
  }
  if (slippageDegraded) {
    warnings.push({ code: "paper_slippage_degraded", severity: "critical", message: "Actual paper slippage is worse than the backtest assumption." });
  }
  if (winRateDegraded) {
    warnings.push({ code: "paper_win_rate_degraded", severity: "critical", message: "Observed paper win rate is below backtest expectations." });
  }
  if (pnlDegraded) {
    warnings.push({ code: "paper_pnl_degraded", severity: "critical", message: "Observed paper P/L is not preserving the backtested edge." });
  }
  if (signalNoFill > 0) {
    warnings.push({ code: "signal_no_fill", severity: "warning", message: "Signals are being generated without fills." });
  }
  if (fillEdgeDisappeared > 0) {
    warnings.push({ code: "fill_edge_disappeared", severity: "warning", message: "Some fills occurred after the modeled edge disappeared." });
  }

  return {
    paperTrades: trades.length,
    settledPaperTrades: settled.length,
    expectedEntryPrice: nullableRound(expectedEntryPrice),
    actualFillPrice: nullableRound(actualFillPrice),
    expectedSlippage: nullableRound(expectedSlippage),
    actualSlippage: nullableRound(actualSlippage),
    expectedWinRate: nullableRound(expectedMetrics.winRate),
    observedWinRate: nullableRound(observedWinRate),
    expectedPnlPerTrade: nullableRound(expectedPnlPerTrade),
    observedPnlPerTrade: nullableRound(observedPnlPerTrade),
    skippedTrades: trades.filter((trade) => trade.status === "rejected" || trade.status === "skipped").length,
    signalNoFill,
    fillEdgeDisappeared,
    liveEdgeDegraded: slippageDegraded || winRateDegraded || pnlDegraded,
    warnings
  };
}

export function evaluateStrategyApproval(input: {
  validationMode: StrategyValidationMode;
  thresholds?: StrategyApprovalThresholds;
  metrics: ExpectancyMetrics;
  dataQuality: DataQualityScore;
  overfitting: AntiOverfittingReport;
  paperValidation?: PaperValidationSummary | null;
}): StrategyApprovalDecision {
  const thresholds = input.thresholds ?? defaultStrategyApprovalThresholds;
  const gates: ApprovalGateResult[] = [
    gate("minimum number of trades", input.metrics.totalTrades >= thresholds.minTrades, input.metrics.totalTrades, thresholds.minTrades, "test sample is large enough"),
    gate("positive test-period ROI", input.metrics.roi > thresholds.minTestPeriodRoi, input.metrics.roi, `>${thresholds.minTestPeriodRoi}`, "ROI after fees and slippage must be positive"),
    gate("max drawdown limit", input.metrics.maxDrawdown <= thresholds.maxDrawdown, input.metrics.maxDrawdown, thresholds.maxDrawdown, "drawdown stays within risk tolerance"),
    gate("win rate or expectancy", input.metrics.winRate >= thresholds.minWinRate || input.metrics.expectedValuePerTrade > thresholds.minExpectancy, `${input.metrics.winRate}/${input.metrics.expectedValuePerTrade}`, `${thresholds.minWinRate} win rate or EV > ${thresholds.minExpectancy}`, "strategy needs either enough wins or positive expectancy"),
    gate("minimum liquidity", (input.metrics.averageLiquidityScore ?? 0) >= thresholds.minLiquidityScore, input.metrics.averageLiquidityScore, thresholds.minLiquidityScore, "markets must be liquid enough to fill"),
    gate("acceptable losing streak", input.metrics.longestLosingStreak <= thresholds.maxLosingStreak, input.metrics.longestLosingStreak, thresholds.maxLosingStreak, "losing streak must be survivable"),
    gate("single trade P/L concentration", input.metrics.singleTradePnlShare <= thresholds.maxSingleTradePnlShare, input.metrics.singleTradePnlShare, thresholds.maxSingleTradePnlShare, "one trade cannot explain most profits"),
    gate("risk of ruin", input.metrics.riskOfRuin <= thresholds.maxRiskOfRuin, input.metrics.riskOfRuin, thresholds.maxRiskOfRuin, "capital-loss probability must stay low"),
    gate("data quality", input.dataQuality.score >= thresholds.minDataQualityScore, input.dataQuality.score, thresholds.minDataQualityScore, "source data must be reliable"),
    gate("rare long-shot wins", !input.metrics.rareLongShotWin, input.metrics.rareLongShotWin ? "flagged" : "clear", "clear", "profits cannot depend on rare long-shot wins"),
    gate("anti-overfitting", !input.overfitting.warnings.some((warning) => warning.severity === "critical"), input.overfitting.parameterFragility, "no critical warnings", "nearby settings and data slices must not collapse")
  ];

  if (input.validationMode === "paper") {
    const paper = input.paperValidation ?? null;
    gates.push(gate("paper sample", (paper?.paperTrades ?? 0) >= thresholds.minPaperTrades, paper?.paperTrades ?? 0, thresholds.minPaperTrades, "paper validation needs enough fills"));
    gates.push(gate("paper edge preservation", paper ? !paper.liveEdgeDegraded : false, paper ? (paper.liveEdgeDegraded ? "degraded" : "preserved") : "missing", "preserved", "live fills must preserve the backtested edge"));
  }

  const failed = gates.filter((item) => !item.passed);
  const baseFailed = failed.filter((item) => item.name !== "paper sample" && item.name !== "paper edge preservation");
  const paperSampleFailed = failed.some((item) => item.name === "paper sample");
  const paperEdgeFailed = failed.some((item) => item.name === "paper edge preservation");
  const paper = input.paperValidation ?? null;
  const paperWarnings = paper?.warnings ?? [];
  const warnings = [...input.overfitting.warnings, ...paperWarnings];
  const status: StrategyApprovalStatus = input.validationMode === "paper"
    ? baseFailed.length > 0 || paperEdgeFailed
      ? "Rejected"
      : paperSampleFailed
        ? "Paper Testing"
        : "Paper Approved"
    : failed.length > 0
      ? "Rejected"
      : input.validationMode === "walk_forward"
        ? "Walk-Forward Passed"
        : "Backtest Passed";

  return {
    status,
    validationMode: input.validationMode,
    approvedForRecommendation: status === "Paper Approved" || status === "Walk-Forward Passed",
    gates,
    warnings,
    explanation: explainStrategyRecommendation(status, input.metrics, input.dataQuality, input.overfitting, paper, thresholds)
  };
}

function explainStrategyRecommendation(
  status: StrategyApprovalStatus,
  metrics: ExpectancyMetrics,
  dataQuality: DataQualityScore,
  overfitting: AntiOverfittingReport,
  paper: PaperValidationSummary | null,
  thresholds: StrategyApprovalThresholds
): StrategyRecommendationExplanation {
  const paperOnly = status !== "Paper Approved";
  const fragility = overfitting.parameterFragility === "low" ? "nearby checks are not currently fragile" : `parameter fragility is ${overfitting.parameterFragility}`;
  const edge = metrics.expectedValuePerTrade > 0
    ? `The edge is positive expectancy: ${money(metrics.expectedValuePerTrade)} expected P/L per trade with a ${percent(metrics.winRate)} win rate.`
    : "No durable edge is proven yet because expected value per trade is not positive.";
  const performsBest = metrics.payoffRatio && metrics.payoffRatio > 1
    ? "It performs best when payoff asymmetry is preserved and fills stay close to the expected entry price."
    : "It performs best when win rate remains stable because payoff asymmetry is limited.";
  const failsWhen = metrics.rareLongShotWin
    ? "It fails realism checks when rare long-shot wins are removed."
    : `It fails when drawdown exceeds ${money(thresholds.maxDrawdown)}, liquidity dries up, or ${fragility}.`;
  const liquidityConditions = `Require average liquidity score above ${thresholds.minLiquidityScore}; current score is ${metrics.averageLiquidityScore === null ? "unknown" : metrics.averageLiquidityScore.toFixed(3)}.`;
  const riskLimits = `Cap losing streaks at ${thresholds.maxLosingStreak}, single-trade profit concentration at ${percent(thresholds.maxSingleTradePnlShare)}, and risk of ruin below ${percent(thresholds.maxRiskOfRuin)}.`;
  const paperStatus = paper ? ` Paper loop: ${paper.liveEdgeDegraded ? "live conditions are degrading the edge." : "live conditions are preserving the edge so far."}` : "";
  return {
    summary: `${status}: ${dataQuality.reliability} data quality, ${metrics.totalTrades} trades, ${percent(metrics.roi)} ROI.${paperStatus}`,
    edge,
    performsBest,
    failsWhen,
    liquidityConditions,
    riskLimits,
    paperOnly
  };
}

function calculateOutlierAdjustedReturn(trades: StrategyTradeResult[]) {
  if (trades.length < 5) {
    const totalCost = sum(trades.map((trade) => trade.cost));
    return totalCost > 0 ? sum(trades.map((trade) => trade.pnl)) / totalCost : 0;
  }
  const removed = trades.length >= 20 ? Math.max(1, Math.ceil(trades.length * 0.05)) : 1;
  const adjusted = [...trades].sort((a, b) => b.pnl - a.pnl).slice(removed);
  const adjustedCost = sum(adjusted.map((trade) => trade.cost));
  return adjustedCost > 0 ? sum(adjusted.map((trade) => trade.pnl)) / adjustedCost : 0;
}

function calculateSingleTradePnlShare(trades: StrategyTradeResult[]) {
  const grossPositive = sum(trades.filter((trade) => trade.pnl > 0).map((trade) => trade.pnl));
  const maxPositive = Math.max(0, ...trades.map((trade) => trade.pnl));
  return grossPositive > 0 ? maxPositive / grossPositive : 0;
}

function estimateRiskOfRuin(input: { winRate: number; expectedValuePerTrade: number; payoffRatio: number; breakEvenWinRate: number | null }) {
  if (input.expectedValuePerTrade <= 0) return 1;
  if (input.breakEvenWinRate === null) return 0;
  if (input.winRate <= input.breakEvenWinRate) return 1;
  const cushion = (input.winRate - input.breakEvenWinRate) / Math.max(0.001, 1 - input.breakEvenWinRate);
  return round(Math.max(0, Math.min(1, Math.pow(1 - cushion, 8))));
}

function buildEquityStats(trades: StrategyTradeResult[]) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let currentLosingStreak = 0;
  let longestLosingStreak = 0;
  for (const trade of [...trades].sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    if (trade.pnl < 0) {
      currentLosingStreak += 1;
      longestLosingStreak = Math.max(longestLosingStreak, currentLosingStreak);
    } else {
      currentLosingStreak = 0;
    }
  }
  return { maxDrawdown: round(maxDrawdown), longestLosingStreak };
}

function feeSensitivityReport(trades: StrategyTradeResult[]): AntiOverfittingReport["feeSensitivity"] {
  const rawCost = sum(trades.map((trade) => trade.rawEntryPrice * trade.contracts));
  const feeAdjustedCost = sum(trades.map((trade) => trade.entryPrice * trade.contracts));
  const payout = sum(trades.map((trade) => trade.payout));
  const rawPnl = payout - rawCost;
  const feeAdjustedPnl = payout - feeAdjustedCost;
  const rawRoi = rawCost > 0 ? rawPnl / rawCost : null;
  const feeAdjustedRoi = feeAdjustedCost > 0 ? feeAdjustedPnl / feeAdjustedCost : null;
  const collapsePct = rawPnl > 0 ? Math.max(0, (rawPnl - feeAdjustedPnl) / rawPnl) : null;
  return {
    rawRoi: nullableRound(rawRoi),
    feeAdjustedRoi: nullableRound(feeAdjustedRoi),
    collapsePct: nullableRound(collapsePct)
  };
}

function largestGroupShare<T>(items: T[], keyFor: (item: T) => string) {
  if (items.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / items.length;
}

function largestPositivePnlGroupShare<T>(items: T[], keyFor: (item: T) => string) {
  const profits = new Map<string, number>();
  let total = 0;
  for (const item of items) {
    const pnl = "pnl" in (item as Record<string, unknown>) && typeof (item as { pnl?: unknown }).pnl === "number" ? (item as { pnl: number }).pnl : 0;
    if (pnl <= 0) continue;
    total += pnl;
    const key = keyFor(item);
    profits.set(key, (profits.get(key) ?? 0) + pnl);
  }
  return total > 0 ? Math.max(...profits.values()) / total : 0;
}

function gate(name: string, passed: boolean, actual: number | string | null, threshold: number | string, reason: string): ApprovalGateResult {
  return { name, passed, actual, threshold, reason };
}

function average(values: Array<number | null>) {
  const real = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return real.length > 0 ? sum(real) / real.length : null;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const right = sorted[mid] ?? 0;
  const left = sorted[mid - 1] ?? right;
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function nullableRound(value: number | null) {
  return value === null ? null : round(value);
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number) {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}
