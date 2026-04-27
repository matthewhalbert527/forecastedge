import type { ForecastDelta, KalshiMarketCandidate, MarketMapping, ProbabilityEstimate } from "../types.js";

export interface ProbabilityConfig {
  sameDayTempStdDevF: number;
  oneDayTempStdDevF: number;
  multiDayTempStdDevF: number;
  minEdge: number;
}

export const defaultProbabilityConfig: ProbabilityConfig = {
  sameDayTempStdDevF: 2,
  oneDayTempStdDevF: 3,
  multiDayTempStdDevF: 4.5,
  minEdge: 0.08
};

export function estimateMarketProbability(
  mapping: MarketMapping,
  delta: ForecastDelta,
  market: KalshiMarketCandidate,
  config: ProbabilityConfig = defaultProbabilityConfig
): ProbabilityEstimate {
  const ask = market.yesAsk ?? (market.noBid !== null ? 1 - market.noBid : null);
  if (!mapping.accepted || mapping.threshold === null || ask === null) {
    return rejected(market.ticker, ask ?? 1, "Market mapping or executable ask is unavailable");
  }

  let yesProbability: number;
  if (mapping.variable === "high_temp" || mapping.variable === "low_temp") {
    const stdDev = stdDevForHorizon(delta.timeHorizonHours, config);
    const z = (delta.newValue - mapping.threshold) / stdDev;
    const aboveProbability = normalCdf(z);
    yesProbability = mapping.thresholdOperator === "below" ? 1 - aboveProbability : aboveProbability;
  } else if (mapping.variable === "rainfall" || mapping.variable === "snowfall") {
    const ratio = Math.max(0, Math.min(1, delta.newValue / Math.max(mapping.threshold, 0.01)));
    yesProbability = Math.max(0.05, Math.min(0.75, ratio * 0.55 + 0.1));
  } else {
    return rejected(market.ticker, ask, "No first-pass model for variable");
  }

  const edge = yesProbability - ask;
  return {
    marketTicker: market.ticker,
    yesProbability: round(yesProbability),
    noProbability: round(1 - yesProbability),
    impliedProbability: round(ask),
    edge: round(edge),
    confidence: mapping.variable === "high_temp" || mapping.variable === "low_temp" ? "medium" : "low",
    reason: `Forecast ${mapping.variable} ${delta.newValue} vs threshold ${mapping.threshold}; executable YES ask ${ask.toFixed(2)}`,
    passesModelFilters: edge >= config.minEdge
  };
}

function rejected(marketTicker: string, impliedProbability: number, reason: string): ProbabilityEstimate {
  return {
    marketTicker,
    yesProbability: 0,
    noProbability: 1,
    impliedProbability,
    edge: -impliedProbability,
    confidence: "low",
    reason,
    passesModelFilters: false
  };
}

function stdDevForHorizon(hours: number, config: ProbabilityConfig) {
  if (hours <= 18) return config.sameDayTempStdDevF;
  if (hours <= 42) return config.oneDayTempStdDevF;
  return config.multiDayTempStdDevF;
}

function normalCdf(x: number) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number) {
  const sign = x >= 0 ? 1 : -1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
  return sign * y;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
