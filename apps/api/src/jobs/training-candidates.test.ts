import { describe, expect, it } from "vitest";
import type { EnsembleForecast, KalshiMarketCandidate, MarketMapping } from "@forecastedge/core";
import { buildTrainingCandidates } from "./training-candidates.js";

function market(ticker: string, yesAsk: number, yesBid: number): KalshiMarketCandidate {
  return {
    ticker,
    eventTicker: ticker.split("-").slice(0, 2).join("-"),
    title: ticker,
    yesAsk,
    yesBid,
    noAsk: 1 - yesBid,
    noBid: 1 - yesAsk,
    lastPrice: yesAsk,
    volume: 1000,
    openInterest: 500,
    rawPayload: {}
  };
}

function mapping(ticker: string, city: string): MarketMapping {
  return {
    marketTicker: ticker,
    eventTicker: ticker.split("-").slice(0, 2).join("-"),
    title: ticker,
    location: { city, state: "IL" },
    station: null,
    settlementSource: "unknown",
    variable: "high_temp",
    threshold: 85,
    thresholdOperator: "above",
    targetDate: "2026-05-02",
    confidence: "high",
    accepted: true,
    reviewReason: null,
    liquidityScore: 0.8
  };
}

function ensemble(city: string, prediction: number, uncertaintyStdDev: number, disagreement: number): EnsembleForecast {
  return {
    id: `ens_${city}`,
    locationId: city.toLowerCase(),
    city,
    state: "IL",
    stationId: null,
    targetDate: "2026-05-02",
    variable: "high_temp",
    prediction,
    uncertaintyStdDev,
    confidence: "high",
    contributingModels: ["a", "b"],
    disagreement,
    reason: "test",
    createdAt: "2026-05-01T12:00:00Z"
  };
}

describe("training candidate quality ranking", () => {
  it("ranks quality score over raw gross edge", () => {
    const highGrossNoisy = "KXHIGHCHI-26MAY02-B85";
    const lowerGrossCleaner = "KXHIGHMIA-26MAY02-B85";
    const candidates = buildTrainingCandidates({
      scanId: "scan_1",
      markets: [market(highGrossNoisy, 0.6, 0.5), market(lowerGrossCleaner, 0.5, 0.48)],
      mappings: [mapping(highGrossNoisy, "Chicago"), mapping(lowerGrossCleaner, "Miami")],
      ensembles: [ensemble("Chicago", 98, 10, 0.1), ensemble("Miami", 86, 2, 0)],
      config: { minEdge: 0, minNetEdge: 0, minQualityScore: 0, maxSpread: 0.5, minLiquidityScore: 0, maxStake: 1, maxContracts: 10 }
    });

    expect(candidates[0]?.marketTicker).toBe(lowerGrossCleaner);
    expect(candidates[1]?.grossEdge ?? 0).toBeGreaterThan(candidates[0]?.grossEdge ?? 0);
    expect(candidates[0]?.qualityScore ?? 0).toBeGreaterThan(candidates[1]?.qualityScore ?? 0);
  });

  it("keeps gross positive but net weak candidates on watch", () => {
    const ticker = "KXHIGHCHI-26MAY02-B85";
    const [candidate] = buildTrainingCandidates({
      scanId: "scan_2",
      markets: [market(ticker, 0.55, 0.25)],
      mappings: [mapping(ticker, "Chicago")],
      ensembles: [ensemble("Chicago", 87, 2, 0)],
      config: { minEdge: 0, minNetEdge: 0.2, minQualityScore: 5, maxSpread: 0.5, minLiquidityScore: 0, maxStake: 1, maxContracts: 10 }
    });

    expect(candidate?.grossEdge ?? 0).toBeGreaterThan(0);
    expect(candidate?.status).toBe("WATCH");
    expect(candidate?.blockers.join("; ")).toContain("net edge below quality threshold");
  });
});
