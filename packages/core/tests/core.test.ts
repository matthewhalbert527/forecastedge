import { describe, expect, it } from "vitest";
import {
  checkRisk,
  defaultRiskLimits,
  detectForecastDeltas,
  estimateMarketProbability,
  generateSignal,
  parseKalshiWeatherMarket,
  buildPaperPositionsFromOrders,
  summarizePaperOrders,
  simulatePaperOrder
} from "../src/index.js";
import type { KalshiMarketCandidate, NormalizedForecastSnapshot, NormalizedOrderBook, RiskState } from "../src/index.js";

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
});

describe("risk limits", () => {
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
});

describe("paper broker", () => {
  it("simulates partial fills from reciprocal order book liquidity", () => {
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
    const order = simulatePaperOrder(signal, orderBook, undefined, new Date("2026-05-01T12:01:01Z"));
    expect(order.status).toBe("PARTIAL");
    expect(order.filledContracts).toBe(2);
    expect(order.unfilledContracts).toBeGreaterThan(0);
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
  });
});
