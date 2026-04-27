import { describe, expect, it } from "vitest";
import {
  checkRisk,
  defaultRiskLimits,
  detectForecastDeltas,
  estimateMarketProbability,
  generateSignal,
  parseKalshiWeatherMarket,
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
