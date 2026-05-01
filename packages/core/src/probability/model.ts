import type { ForecastDelta, KalshiMarketCandidate, MarketMapping, ProbabilityEstimate } from "../types.js";
import { calibrateProbability, type ProbabilityCalibrationMap } from "./calibration.js";

export interface ProbabilityConfig {
  sameDayTempStdDevF: number;
  oneDayTempStdDevF: number;
  multiDayTempStdDevF: number;
  minEdge: number;
  calibrationMap?: ProbabilityCalibrationMap | null;
  modelVersion?: string;
}

export interface ProbabilityForecastInput {
  forecastValue: number | null;
  timeHorizonHours?: number | null;
  uncertaintyStdDev?: number | null;
  disagreement?: number | null;
  confidence?: ProbabilityEstimate["confidence"] | null;
}

export const defaultProbabilityConfig: ProbabilityConfig = {
  sameDayTempStdDevF: 2,
  oneDayTempStdDevF: 3,
  multiDayTempStdDevF: 4.5,
  minEdge: 0.08,
  calibrationMap: null,
  modelVersion: "forecastedge_probability_v2"
};

export function estimateMarketProbability(
  mapping: MarketMapping,
  forecast: ForecastDelta | ProbabilityForecastInput,
  market: KalshiMarketCandidate,
  config: ProbabilityConfig = defaultProbabilityConfig
): ProbabilityEstimate {
  const ask = market.yesAsk ?? (market.noBid !== null ? 1 - market.noBid : null);
  if (!mapping.accepted || mapping.threshold === null || ask === null) {
    return rejected(market.ticker, ask ?? 1, "Market mapping or executable ask is unavailable");
  }

  const input = forecastInput(forecast);
  if (input.forecastValue === null) {
    return rejected(market.ticker, ask, "Forecast value is unavailable");
  }

  let rawYesProbability: number;
  let uncertaintyStdDev: number | null = input.uncertaintyStdDev;
  if (mapping.variable === "high_temp" || mapping.variable === "low_temp") {
    const stdDev = Math.max(input.uncertaintyStdDev ?? stdDevForHorizon(input.timeHorizonHours ?? 48, config), 0.5);
    uncertaintyStdDev = stdDev;
    const z = (input.forecastValue - mapping.threshold) / stdDev;
    const aboveProbability = normalCdf(z);
    rawYesProbability = mapping.thresholdOperator === "below" ? 1 - aboveProbability : aboveProbability;
  } else if (mapping.variable === "rainfall" || mapping.variable === "snowfall") {
    const ratio = Math.max(0, Math.min(1, input.forecastValue / Math.max(mapping.threshold, 0.01)));
    rawYesProbability = Math.max(0.05, Math.min(0.75, ratio * 0.55 + 0.1));
  } else if (mapping.variable === "wind_gust") {
    const stdDev = Math.max(input.uncertaintyStdDev ?? 6, 2);
    uncertaintyStdDev = stdDev;
    rawYesProbability = normalCdf((input.forecastValue - mapping.threshold) / stdDev);
  } else {
    return rejected(market.ticker, ask, "No first-pass model for variable");
  }

  const calibratedYesProbability = calibrateProbability(rawYesProbability, config.calibrationMap);
  const grossEdge = calibratedYesProbability - ask;
  const confidence = input.confidence ?? (mapping.variable === "high_temp" || mapping.variable === "low_temp" ? "medium" : "low");
  return {
    marketTicker: market.ticker,
    rawYesProbability: round(rawYesProbability),
    calibratedYesProbability: round(calibratedYesProbability),
    yesProbability: round(calibratedYesProbability),
    noProbability: round(1 - calibratedYesProbability),
    impliedProbability: round(ask),
    grossEdge: round(grossEdge),
    edge: round(grossEdge),
    uncertaintyStdDev: uncertaintyStdDev === null ? null : round(uncertaintyStdDev),
    disagreement: input.disagreement === null ? null : round(input.disagreement),
    confidence,
    modelVersion: config.modelVersion ?? defaultProbabilityConfig.modelVersion ?? "forecastedge_probability_v2",
    reason: `Forecast ${mapping.variable} ${input.forecastValue} vs threshold ${mapping.threshold}; raw YES ${(rawYesProbability * 100).toFixed(1)}%, calibrated YES ${(calibratedYesProbability * 100).toFixed(1)}%, executable YES ask ${ask.toFixed(2)}`,
    passesModelFilters: grossEdge >= config.minEdge
  };
}

function rejected(marketTicker: string, impliedProbability: number, reason: string): ProbabilityEstimate {
  return {
    marketTicker,
    rawYesProbability: 0,
    calibratedYesProbability: 0,
    yesProbability: 0,
    noProbability: 1,
    impliedProbability,
    grossEdge: -impliedProbability,
    edge: -impliedProbability,
    uncertaintyStdDev: null,
    disagreement: null,
    confidence: "low",
    modelVersion: defaultProbabilityConfig.modelVersion ?? "forecastedge_probability_v2",
    reason,
    passesModelFilters: false
  };
}

function forecastInput(forecast: ForecastDelta | ProbabilityForecastInput): Required<Pick<ProbabilityForecastInput, "forecastValue" | "uncertaintyStdDev" | "disagreement" | "confidence">> & { timeHorizonHours: number | null } {
  if ("newValue" in forecast) {
    return {
      forecastValue: forecast.newValue,
      timeHorizonHours: forecast.timeHorizonHours,
      uncertaintyStdDev: null,
      disagreement: null,
      confidence: forecast.confidence
    };
  }
  return {
    forecastValue: forecast.forecastValue,
    timeHorizonHours: forecast.timeHorizonHours ?? null,
    uncertaintyStdDev: forecast.uncertaintyStdDev ?? null,
    disagreement: forecast.disagreement ?? null,
    confidence: forecast.confidence ?? null
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
