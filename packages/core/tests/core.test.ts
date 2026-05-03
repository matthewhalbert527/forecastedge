import { describe, expect, it } from "vitest";
import {
  checkRisk,
  buildEnsembles,
  calculateExpectancyMetrics,
  buildBucketCalibrationMap,
  defaultRiskLimits,
  defaultStrategyApprovalThresholds,
  detectForecastDeltas,
  detectAntiOverfitting,
  evaluateStrategyApproval,
  estimateMarketProbability,
  calibrateProbability,
  computeTradeQuality,
  fractionalKellyForBinary,
  generateSignal,
  parseKalshiWeatherMarket,
  buildPaperPositionsFromOrders,
  scoreDataQuality,
  summarizePaperPerformanceWindows,
  summarizePaperOrders,
  simulatePaperOrder
} from "../src/index.js";
import type { KalshiMarketCandidate, NormalizedForecastSnapshot, NormalizedOrderBook, ProbabilityEstimate, RiskState } from "../src/index.js";

const location = {
  id: "chicago",
  city: "Chicago",
  state: "IL",
  latitude: 41.8781,
  longitude: -87.6298,
  timezone: "America/Chicago",
  pollingIntervalMinutes: 30
};

function snapshot(id: string, high: number, rainPct = 20): NormalizedForecastSnapshot {
  return {
    id,
    provider: "open_meteo",
    location,
    forecastRunAt: "2026-05-01T12:00:00Z",
    hourly: [],
    daily: [
      {
        targetDate: "2026-05-02",
        highTempF: high,
        lowTempF: 60,
        precipitationProbabilityPct: rainPct,
        precipitationAmountIn: 0.02,
        snowAmountIn: 0,
        windSpeedMph: 12,
        windGustMph: 20
      }
    ],
    rawPayload: {},
    createdAt: "2026-05-01T12:00:00Z"
  };
}

const market: KalshiMarketCandidate = {
  ticker: "KXHIGHCHI-26MAY02-B85",
  eventTicker: "KXHIGHCHI-26MAY02",
  title: "Will the high temperature in Chicago be above 85°F on 2026-05-02?",
  subtitle: "Chicago daily high temperature",
  closeTime: "2026-05-02T23:00:00Z",
  settlementTime: "2026-05-03T03:00:00Z",
  yesBid: 0.08,
  yesAsk: 0.1,
  noBid: 0.9,
  noAsk: 0.92,
  lastPrice: 0.09,
  volume: 1200,
  openInterest: 500,
  rawPayload: {}
};

const riskState: RiskState = {
  realizedPnlToday: 0,
  tradesToday: 0,
  openExposure: 0,
  openPositions: 0,
  losingStreak: 0,
  exposureByCity: {},
  exposureByWeatherType: {}
};

function probability(overrides: Partial<ProbabilityEstimate> = {}): ProbabilityEstimate {
  return {
    marketTicker: "KXHIGHCHI-26MAY02-B85",
    rawYesProbability: 0.68,
    calibratedYesProbability: 0.66,
    yesProbability: 0.66,
    noProbability: 0.34,
    impliedProbability: 0.48,
    grossEdge: 0.18,
    edge: 0.18,
    uncertaintyStdDev: 3,
    disagreement: 0.02,
    confidence: "medium",
    modelVersion: "test",
    reason: "test probability",
    passesModelFilters: true,
    ...overrides
  };
}

describe("forecast deltas", () => {
  it("detects meaningful temperature and rain probability changes", () => {
    const deltas = detectForecastDeltas(snapshot("old", 82, 20), snapshot("new", 86, 40));
    expect(deltas.map((delta) => delta.variable)).toEqual(["high_temp", "rainfall"]);
  });
});

describe("Kalshi market parsing", () => {
  it("accepts clear weather markets and extracts threshold", () => {
    const mapping = parseKalshiWeatherMarket(market);
    expect(mapping.accepted).toBe(true);
    expect(mapping.variable).toBe("high_temp");
    expect(mapping.threshold).toBe(85);
    expect(mapping.location?.city).toBe("Chicago");
    expect(mapping.station?.stationId).toBe("KMDW");
    expect(mapping.settlementSource).toBe("nws_daily_climate_report");
  });

  it("rejects uncertain mappings for manual review", () => {
    const mapping = parseKalshiWeatherMarket({ ...market, title: "Will it be warm somewhere?", subtitle: "daily market", ticker: "UNKNOWN" });
    expect(mapping.accepted).toBe(false);
    expect(mapping.reviewReason).toContain("location");
  });

  it("parses Kalshi threshold values encoded in temperature market tickers", () => {
    const mapping = parseKalshiWeatherMarket({
      ...market,
      ticker: "KXHIGHNY-26APR28-B65.5",
      eventTicker: "KXHIGHNY-26APR28",
      title: "Will the high temperature in New York be above 65.5?",
      subtitle: "New York City weather"
    });
    expect(mapping.accepted).toBe(true);
    expect(mapping.threshold).toBe(65.5);
    expect(mapping.thresholdOperator).toBe("above");
    expect(mapping.station?.stationId).toBe("KNYC");
  });

  it("maps expanded settlement station aliases for likely weather locations", () => {
    const mapping = parseKalshiWeatherMarket({
      ...market,
      ticker: "KXHIGHPHX-26APR28-T99",
      eventTicker: "KXHIGHPHX-26APR28",
      title: "Will the high temp in Phoenix be >99° on Apr 28, 2026?",
      subtitle: "100° or above"
    });
    expect(mapping.accepted).toBe(true);
    expect(mapping.station?.stationId).toBe("KPHX");
    expect(mapping.threshold).toBe(99);
    expect(mapping.targetDate).toBe("2026-04-28");
  });

  it("uses the ticker date when title date text is missing", () => {
    const mapping = parseKalshiWeatherMarket({
      ...market,
      ticker: "KXHIGHNY-26APR28-B65.5",
      eventTicker: "KXHIGHNY-26APR28",
      title: "Will the high temperature in New York be above 65.5?",
      subtitle: "New York City weather",
      closeTime: "2026-04-29T04:59:00Z"
    });
    expect(mapping.targetDate).toBe("2026-04-28");
  });
});

describe("probability and signal engine", () => {
  it("computes positive edge and generates an allowed paper signal", () => {
    const [delta] = detectForecastDeltas(snapshot("old", 82), snapshot("new", 88));
    expect(delta).toBeDefined();
    const mapping = parseKalshiWeatherMarket(market);
    const estimate = estimateMarketProbability(mapping, delta!, market);
    const risk = checkRisk(
      { maxCost: 0.5, contracts: 5 },
      riskState,
      defaultRiskLimits,
      mapping,
      market,
      "2026-05-01T12:00:00Z",
      "2026-05-01T12:00:00Z",
      new Date("2026-05-01T12:01:00Z")
    );
    const signal = generateSignal(delta!, market, mapping, estimate, risk, undefined, new Date("2026-05-01T12:01:00Z"));
    expect(estimate.edge).toBeGreaterThan(0.08);
    expect(signal.status).toBe("FIRED");
    expect(signal.explanation).toContain("Paper buy allowed");
  });

  it("separates raw and calibrated probability with safe bucket fallback", () => {
    const sparseMap = buildBucketCalibrationMap([{ predictedProbability: 0.7, outcome: false }], { minSamples: 10 });
    expect(calibrateProbability(0.7, sparseMap)).toBe(0.7);

    const observations = Array.from({ length: 30 }, () => ({ predictedProbability: 0.72, outcome: false }))
      .concat(Array.from({ length: 10 }, () => ({ predictedProbability: 0.72, outcome: true })));
    const map = buildBucketCalibrationMap(observations, { bucketCount: 5, minSamples: 10 });
    expect(calibrateProbability(0.72, map)).toBeLessThan(0.72);
  });

  it("sizes with fractional Kelly and shrinks for uncertainty", () => {
    const clean = computeTradeQuality({ probability: probability(), entryPrice: 0.48, spread: 0.02, liquidityScore: 0.8, config: { maxStake: 1, maxContracts: 10 } });
    const uncertain = computeTradeQuality({ probability: probability({ uncertaintyStdDev: 12, disagreement: 0.2 }), entryPrice: 0.48, spread: 0.02, liquidityScore: 0.8, config: { maxStake: 1, maxContracts: 10 } });
    expect(fractionalKellyForBinary(0.66, 0.48, 0.12)).toBeGreaterThan(0);
    expect(clean.qualityScore ?? 0).toBeGreaterThan(uncertain.qualityScore ?? 0);
    expect(clean.recommendedStake ?? 0).toBeGreaterThanOrEqual(uncertain.recommendedStake ?? 0);
  });
});

describe("risk limits", () => {
  it("allows up to 30 paper purchases per day by default", () => {
    expect(defaultRiskLimits.maxDailyTrades).toBe(30);
  });

  it("rejects stale market data and wide spreads", () => {
    const mapping = parseKalshiWeatherMarket(market);
    const result = checkRisk(
      { maxCost: 0.5, contracts: 5 },
      riskState,
      defaultRiskLimits,
      mapping,
      { ...market, yesAsk: 0.3 },
      "2026-05-01T11:00:00Z",
      "2026-05-01T12:00:00Z",
      new Date("2026-05-01T12:10:00Z")
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("market data is stale");
    expect(result.reasons).toContain("spread is too wide");
  });

  it("rejects correlated exposure and low quality fills", () => {
    const mapping = parseKalshiWeatherMarket(market);
    const correlationKey = `${mapping.location?.city}:2026-05-02:${mapping.variable}:${market.eventTicker}`;
    const result = checkRisk(
      { maxCost: 0.5, contracts: 1, qualityScore: 2, netEdge: 0.01, fillPenalty: 0.12, uncertaintyPenalty: 0.02 },
      { ...riskState, exposureByCorrelationKey: { [correlationKey]: defaultRiskLimits.maxCorrelationExposure } },
      defaultRiskLimits,
      mapping,
      market,
      "2026-05-01T12:00:00Z",
      "2026-05-01T12:00:00Z",
      new Date("2026-05-01T12:01:00Z")
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("quality score is too low");
    expect(result.reasons).toContain("expected fill quality is too low");
    expect(result.reasons).toContain("correlated city/date/variable exposure would be exceeded");
  });
});

describe("paper broker", () => {
  it("can simulate partial fills from reciprocal order book liquidity", () => {
    const [delta] = detectForecastDeltas(snapshot("old", 82), snapshot("new", 88));
    const mapping = parseKalshiWeatherMarket(market);
    const estimate = estimateMarketProbability(mapping, delta!, market);
    const risk = { allowed: true, reasons: [] };
    const signal = generateSignal(delta!, market, mapping, estimate, risk, { minEdge: 0.08, minNetEdge: 0.03, minQualityScore: 3, maxStake: 20, maxContracts: 10, maxLongshotPrice: 0.15 }, new Date("2026-05-01T12:01:00Z"));
    const orderBook: NormalizedOrderBook = {
      marketTicker: market.ticker,
      yesBids: [[0.08, 10]].map(([price, contracts]) => ({ price, contracts })),
      noBids: [{ price: 0.9, contracts: 2 }],
      observedAt: "2026-05-01T12:01:00Z"
    };
    const largerSignal = { ...signal, contracts: Math.max(3, signal.contracts), maxCost: Number((Math.max(3, signal.contracts) * signal.limitPrice).toFixed(2)) };
    const order = simulatePaperOrder(largerSignal, orderBook, { staleQuoteMs: 120_000, slippageCents: 1, fillApprovedSignalsHypothetically: false }, new Date("2026-05-01T12:01:01Z"));
    expect(order.status).toBe("PARTIAL");
    expect(order.filledContracts).toBeGreaterThan(0);
    expect(order.filledContracts).toBeLessThan(largerSignal.contracts);
    expect(order.unfilledContracts).toBeGreaterThan(0);
  });

  it("does not fabricate full fills when displayed liquidity is thin by default", () => {
    const [delta] = detectForecastDeltas(snapshot("old", 82), snapshot("new", 88));
    const mapping = parseKalshiWeatherMarket(market);
    const estimate = estimateMarketProbability(mapping, delta!, market);
    const risk = { allowed: true, reasons: [] };
    const signal = generateSignal(delta!, market, mapping, estimate, risk, undefined, new Date("2026-05-01T12:01:00Z"));
    const orderBook: NormalizedOrderBook = {
      marketTicker: market.ticker,
      yesBids: [[0.08, 10]].map(([price, contracts]) => ({ price, contracts })),
      noBids: [{ price: 0.9, contracts: 2 }],
      observedAt: "2026-05-01T12:01:00Z"
    };
    const largerSignal = { ...signal, contracts: Math.max(3, signal.contracts), maxCost: Number((Math.max(3, signal.contracts) * signal.limitPrice).toFixed(2)) };
    const order = simulatePaperOrder(largerSignal, orderBook, undefined, new Date("2026-05-01T12:01:01Z"));
    expect(order.status).toBe("PARTIAL");
    expect(order.filledContracts).toBeGreaterThan(0);
    expect(order.filledContracts).toBeLessThan(largerSignal.contracts);
    expect(order.unfilledContracts).toBeGreaterThan(0);
  });

  it("rejects the approved paper signal when the order book is unavailable by default", () => {
    const [delta] = detectForecastDeltas(snapshot("old", 82), snapshot("new", 88));
    const mapping = parseKalshiWeatherMarket(market);
    const estimate = estimateMarketProbability(mapping, delta!, market);
    const risk = { allowed: true, reasons: [] };
    const signal = generateSignal(delta!, market, mapping, estimate, risk, undefined, new Date("2026-05-01T12:01:00Z"));
    const order = simulatePaperOrder(signal, null, undefined, new Date("2026-05-01T12:01:01Z"));
    expect(order.status).toBe("REJECTED");
    expect(order.filledContracts).toBe(0);
    expect(order.simulatedAvgFillPrice).toBeNull();
    expect(order.reason).toContain("order book unavailable");
  });
});

describe("paper settlement performance", () => {
  it("aggregates filled paper orders into open positions", () => {
    const orders = [
      {
        id: "paper_1",
        timestamp: "2026-05-01T12:00:00Z",
        marketTicker: "KXHIGHCHI-26MAY02-B85",
        side: "YES" as const,
        action: "BUY" as const,
        requestedContracts: 5,
        limitPrice: 0.1,
        simulatedAvgFillPrice: 0.11,
        filledContracts: 2,
        unfilledContracts: 3,
        status: "PARTIAL" as const,
        reason: "partial fill",
        linkedSignalId: "signal_1"
      }
    ];
    const positions = buildPaperPositionsFromOrders(orders);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.contracts).toBe(2);
    expect(positions[0]?.closedAt).toBeNull();
  });

  it("settles YES winners and losers with realized P/L", () => {
    const baseOrder = {
      timestamp: "2026-05-01T12:00:00Z",
      marketTicker: "KXHIGHCHI-26MAY02-B85",
      action: "BUY" as const,
      requestedContracts: 2,
      limitPrice: 0.25,
      simulatedAvgFillPrice: 0.25,
      filledContracts: 2,
      unfilledContracts: 0,
      status: "FILLED" as const,
      reason: "filled",
      linkedSignalId: "signal_1"
    };
    const winner = buildPaperPositionsFromOrders([{ ...baseOrder, id: "paper_yes", side: "YES" as const }], [{ id: "settlement_1", marketTicker: baseOrder.marketTicker, result: "yes", settledPrice: 1, source: "kalshi_market_result", rawPayload: {}, createdAt: "2026-05-03T00:00:00Z" }]);
    const loser = buildPaperPositionsFromOrders([{ ...baseOrder, id: "paper_no", side: "NO" as const }], [{ id: "settlement_1", marketTicker: baseOrder.marketTicker, result: "yes", settledPrice: 1, source: "kalshi_market_result", rawPayload: {}, createdAt: "2026-05-03T00:00:00Z" }]);
    expect(winner[0]?.realizedPnl).toBe(1.5);
    expect(loser[0]?.realizedPnl).toBe(-0.5);
  });

  it("computes realized performance, drawdown, and losing streak", () => {
    const orders = [
      {
        id: "paper_1",
        timestamp: "2026-05-01T12:00:00Z",
        marketTicker: "KXHIGHCHI-26MAY02-B85",
        side: "YES" as const,
        action: "BUY" as const,
        requestedContracts: 1,
        limitPrice: 0.2,
        simulatedAvgFillPrice: 0.2,
        filledContracts: 1,
        unfilledContracts: 0,
        status: "FILLED" as const,
        reason: "filled",
        linkedSignalId: "signal_1"
      },
      {
        id: "paper_2",
        timestamp: "2026-05-01T13:00:00Z",
        marketTicker: "KXHIGHCHI-26MAY03-B85",
        side: "YES" as const,
        action: "BUY" as const,
        requestedContracts: 1,
        limitPrice: 0.4,
        simulatedAvgFillPrice: 0.4,
        filledContracts: 1,
        unfilledContracts: 0,
        status: "FILLED" as const,
        reason: "filled",
        linkedSignalId: "signal_2"
      }
    ];
    const settlements = [
      { id: "settlement_1", marketTicker: "KXHIGHCHI-26MAY02-B85", result: "yes" as const, settledPrice: 1, source: "kalshi_market_result", rawPayload: {}, createdAt: "2026-05-03T00:00:00Z" },
      { id: "settlement_2", marketTicker: "KXHIGHCHI-26MAY03-B85", result: "no" as const, settledPrice: 0, source: "kalshi_market_result", rawPayload: {}, createdAt: "2026-05-04T00:00:00Z" }
    ];
    const positions = buildPaperPositionsFromOrders(orders, settlements);
    const summary = summarizePaperOrders(orders, positions, settlements);
    expect(summary.realizedPnl).toBe(0.4);
    expect(summary.winRate).toBe(0.5);
    expect(summary.maxDrawdown).toBe(0.4);
    expect(summary.longestLosingStreak).toBe(1);
    const [window] = summarizePaperPerformanceWindows(positions, [{ key: "24h", label: "24 hours", hours: 24 }], new Date("2026-05-04T12:00:00Z"));
    expect(window?.settledTrades).toBe(1);
    expect(window?.score).toBe(0);
    expect(window?.totalPnl).toBe(-0.4);
  });
});

describe("model ensemble", () => {
  it("weights short-range HRRR above ECMWF for same-day temperature", () => {
    const now = new Date("2026-05-01T12:00:00Z");
    const common = {
      id: "model_1",
      locationId: "chicago",
      city: "Chicago",
      state: "IL",
      stationId: "KMDW",
      modelRunAt: now.toISOString(),
      forecastValidAt: "2026-05-01T18:00:00Z",
      targetDate: "2026-05-01",
      horizonHours: 6,
      lowTempF: 60,
      precipitationAmountIn: 0,
      precipitationProbabilityPct: 0,
      windGustMph: 15,
      uncertaintyStdDevF: 2,
      freshnessMinutes: 0,
      confidence: "medium" as const,
      rawPayload: {},
      createdAt: now.toISOString()
    };
    const ensembles = buildEnsembles([
      { ...common, id: "hrrr", model: "hrrr", highTempF: 90 },
      { ...common, id: "ecmwf", model: "ecmwf_ifs", highTempF: 84 }
    ], now);
    const high = ensembles.find((ensemble) => ensemble.variable === "high_temp");
    expect(high?.prediction).toBeGreaterThan(87);
    expect(high?.contributingModels).toEqual(expect.arrayContaining(["hrrr", "ecmwf_ifs"]));
    expect(high?.confidence).toBe("high");
  });
});

describe("strategy decision engine", () => {
  const strategyTrades = Array.from({ length: 40 }, (_, index) => {
    const win = index % 2 === 0;
    return {
      marketTicker: `KXHIGHCHI-26MAY${String(index + 1).padStart(2, "0")}-B85`,
      observedAt: `2026-05-${String((index % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      pnl: win ? 0.6 : -0.3,
      cost: win ? 0.4 : 0.3,
      payout: win ? 1 : 0,
      roi: win ? 1.5 : -1,
      contracts: 1,
      entryPrice: win ? 0.4 : 0.3,
      rawEntryPrice: win ? 0.39 : 0.29,
      liquidityScore: 0.2,
      city: index < 20 ? "Chicago" : "Miami",
      variable: "high_temp",
      targetDate: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
      eventKey: `event_${index}`
    };
  });

  it("calculates expectancy and approves robust walk-forward runs", () => {
    const thresholds = { ...defaultStrategyApprovalThresholds, maxDrawdown: 100 };
    const metrics = calculateExpectancyMetrics(strategyTrades, thresholds);
    const dataQuality = scoreDataQuality({
      totalMarkets: strategyTrades.length,
      missingMarketPrices: 0,
      missingForecastSnapshots: 0,
      staleForecasts: 0,
      settlementAmbiguities: 0,
      lowLiquidityMarkets: 0,
      suspiciousPriceGaps: 0,
      duplicateMarketRows: 0,
      incompleteMarketHistories: 0,
      latestMarketDataAt: "2026-05-30T00:00:00Z",
      latestForecastAt: "2026-05-30T00:00:00Z"
    });
    const overfitting = detectAntiOverfitting({
      trades: strategyTrades,
      candidateSnapshots: 80,
      eligibleSnapshots: 50,
      parameters: { minEdge: 0.05 },
      thresholds
    });
    const decision = evaluateStrategyApproval({ validationMode: "walk_forward", thresholds, metrics, dataQuality, overfitting });
    expect(metrics.expectedValuePerTrade).toBeGreaterThan(0);
    expect(metrics.profitFactor).toBeGreaterThan(1);
    expect(decision.status).toBe("Walk-Forward Passed");
    expect(decision.approvedForRecommendation).toBe(true);
  });

  it("calculates trade-quality validation metrics for approval gates", () => {
    const qualityTrades = strategyTrades.map((trade, index) => ({
      ...trade,
      qualityScore: index,
      calibratedYesProbability: 0.9,
      impliedProbability: 0.5,
      grossEdge: trade.pnl > 0 ? 0.22 : -0.12,
      netEdge: trade.pnl > 0 ? 0.12 : 0.02,
      pnl: index < 10 ? 0.05 : index < 20 ? 0.1 : 0.2,
      roi: index < 10 ? 0.1 : index < 20 ? 0.2 : 0.4
    }));
    const metrics = calculateExpectancyMetrics(qualityTrades, { ...defaultStrategyApprovalThresholds, maxDrawdown: 100 });
    expect(metrics.positiveNetEdgeShare).toBeGreaterThan(0.6);
    expect(metrics.calibrationMeanAbsoluteError).toBeLessThan(defaultStrategyApprovalThresholds.maxCalibrationError);
    expect(metrics.monotonicQualityDeciles).toBe(true);
    expect(metrics.fillAdjustedEdgeCaptureRatio).toBeGreaterThan(0);
  });

  it("describes failed minimum-trade approval gates as blockers", () => {
    const thresholds = { ...defaultStrategyApprovalThresholds, maxDrawdown: 100, minTrades: 10 };
    const trades = strategyTrades.slice(0, 3);
    const metrics = calculateExpectancyMetrics(trades, thresholds);
    const dataQuality = scoreDataQuality({
      totalMarkets: trades.length,
      missingMarketPrices: 0,
      missingForecastSnapshots: 0,
      staleForecasts: 0,
      settlementAmbiguities: 0,
      lowLiquidityMarkets: 0,
      suspiciousPriceGaps: 0,
      duplicateMarketRows: 0,
      incompleteMarketHistories: 0,
      latestMarketDataAt: "2026-05-30T00:00:00Z",
      latestForecastAt: "2026-05-30T00:00:00Z"
    });
    const overfitting = detectAntiOverfitting({ trades, candidateSnapshots: 3, eligibleSnapshots: 3, parameters: {}, thresholds });
    const decision = evaluateStrategyApproval({ validationMode: "backtest", thresholds, metrics, dataQuality, overfitting });
    const minimumTradesGate = decision.gates.find((gate) => gate.name === "minimum number of trades");
    expect(minimumTradesGate?.passed).toBe(false);
    expect(minimumTradesGate?.reason).toBe("test sample must include enough trades");
  });

  it("rejects strategies where one long-shot win explains profitability", () => {
    const trades = [
      ...Array.from({ length: 35 }, (_, index) => ({
        ...strategyTrades[index % strategyTrades.length]!,
        marketTicker: `loss_${index}`,
        pnl: -0.1,
        cost: 0.1,
        payout: 0,
        roi: -1,
        eventKey: `loss_event_${index}`
      })),
      {
        ...strategyTrades[0]!,
        marketTicker: "rare_longshot",
        pnl: 10,
        cost: 0.05,
        payout: 10.05,
        roi: 200,
        eventKey: "one_event"
      }
    ];
    const thresholds = { ...defaultStrategyApprovalThresholds, maxDrawdown: 100 };
    const metrics = calculateExpectancyMetrics(trades, thresholds);
    const dataQuality = scoreDataQuality({
      totalMarkets: trades.length,
      missingMarketPrices: 0,
      missingForecastSnapshots: 0,
      staleForecasts: 0,
      settlementAmbiguities: 0,
      lowLiquidityMarkets: 0,
      suspiciousPriceGaps: 0,
      duplicateMarketRows: 0,
      incompleteMarketHistories: 0,
      latestMarketDataAt: "2026-05-30T00:00:00Z",
      latestForecastAt: "2026-05-30T00:00:00Z"
    });
    const overfitting = detectAntiOverfitting({ trades, candidateSnapshots: 60, eligibleSnapshots: 36, parameters: {}, thresholds });
    const decision = evaluateStrategyApproval({ validationMode: "backtest", thresholds, metrics, dataQuality, overfitting });
    expect(metrics.rareLongShotWin).toBe(true);
    expect(decision.status).toBe("Rejected");
  });

  it("keeps paper validation in testing until enough paper fills exist", () => {
    const thresholds = { ...defaultStrategyApprovalThresholds, maxDrawdown: 100 };
    const metrics = calculateExpectancyMetrics(strategyTrades, thresholds);
    const dataQuality = scoreDataQuality({
      totalMarkets: strategyTrades.length,
      missingMarketPrices: 0,
      missingForecastSnapshots: 0,
      staleForecasts: 0,
      settlementAmbiguities: 0,
      lowLiquidityMarkets: 0,
      suspiciousPriceGaps: 0,
      duplicateMarketRows: 0,
      incompleteMarketHistories: 0,
      latestMarketDataAt: "2026-05-30T00:00:00Z",
      latestForecastAt: "2026-05-30T00:00:00Z"
    });
    const overfitting = detectAntiOverfitting({ trades: strategyTrades, candidateSnapshots: 80, eligibleSnapshots: 50, parameters: {}, thresholds });
    const decision = evaluateStrategyApproval({
      validationMode: "paper",
      thresholds,
      metrics,
      dataQuality,
      overfitting,
      paperValidation: {
        paperTrades: 3,
        settledPaperTrades: 2,
        expectedEntryPrice: 0.4,
        actualFillPrice: 0.41,
        expectedSlippage: 0.01,
        actualSlippage: 0.01,
        expectedWinRate: metrics.winRate,
        observedWinRate: metrics.winRate,
        expectedPnlPerTrade: metrics.expectedValuePerTrade,
        observedPnlPerTrade: metrics.expectedValuePerTrade,
        skippedTrades: 0,
        signalNoFill: 0,
        fillEdgeDisappeared: 0,
        liveEdgeDegraded: false,
        edgePreservationByScoreBucket: null,
        warnings: []
      }
    });
    expect(decision.status).toBe("Paper Testing");
    expect(decision.approvedForRecommendation).toBe(false);
  });
});
