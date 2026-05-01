import type { KalshiMarketCandidate, MarketMapping, RiskCheckResult, RiskLimits, RiskState, Signal } from "../types.js";

export const defaultRiskLimits: RiskLimits = {
  maxStakePerTrade: 0.5,
  maxContractsPerTrade: 10,
  maxDailyLoss: 10,
  maxDailyTrades: 30,
  maxOpenExposure: 25,
  maxExposurePerCity: 10,
  maxExposurePerWeatherType: 10,
  maxOpenPositions: 20,
  cooldownLossCount: 3,
  staleMarketDataSeconds: 120,
  staleForecastDataMinutes: 90,
  maxSpread: 0.1,
  minLiquidityScore: 0.01,
  maxUncertaintyPenalty: 0.12,
  maxFillPenalty: 0.08,
  maxDiversificationPenalty: 0.12,
  minQualityScore: 3,
  maxCorrelationExposure: 5
};

export function checkRisk(
  signal: Pick<Signal, "maxCost" | "contracts"> & Partial<Pick<Signal, "qualityScore" | "netEdge" | "uncertaintyPenalty" | "fillPenalty" | "diversificationPenalty">>,
  state: RiskState,
  limits: RiskLimits,
  mapping: MarketMapping,
  market: KalshiMarketCandidate,
  marketObservedAt: string,
  forecastObservedAt: string,
  now = new Date()
): RiskCheckResult {
  const reasons: string[] = [];
  const spread = market.yesAsk !== null && market.yesBid !== null ? market.yesAsk - market.yesBid : Infinity;
  const city = mapping.location?.city ?? "unknown";
  const weatherType = mapping.variable;
  const correlationKey = `${city}:${mapping.targetDate ?? "unknown"}:${weatherType}:${market.eventTicker}`;

  if (!mapping.accepted || mapping.confidence !== "high") reasons.push("market mapping is not high confidence");
  if (signal.maxCost > limits.maxStakePerTrade) reasons.push("stake exceeds max stake per trade");
  if (signal.contracts > limits.maxContractsPerTrade) reasons.push("contracts exceed max contracts per trade");
  if (state.realizedPnlToday <= -Math.abs(limits.maxDailyLoss)) reasons.push("max daily loss reached");
  if (state.tradesToday >= limits.maxDailyTrades) reasons.push("max daily trades reached");
  if (state.openExposure + signal.maxCost > limits.maxOpenExposure) reasons.push("max open exposure would be exceeded");
  if ((state.exposureByCity[city] ?? 0) + signal.maxCost > limits.maxExposurePerCity) reasons.push("max city exposure would be exceeded");
  if ((state.exposureByWeatherType[weatherType] ?? 0) + signal.maxCost > limits.maxExposurePerWeatherType) reasons.push("max weather type exposure would be exceeded");
  if (state.openPositions >= limits.maxOpenPositions) reasons.push("max open positions reached");
  if (state.losingStreak >= limits.cooldownLossCount) reasons.push("cooldown after losing streak active");
  if (secondsBetween(marketObservedAt, now) > limits.staleMarketDataSeconds) reasons.push("market data is stale");
  if (secondsBetween(forecastObservedAt, now) > limits.staleForecastDataMinutes * 60) reasons.push("forecast data is stale");
  if (!Number.isFinite(spread) || spread > limits.maxSpread) reasons.push("spread is too wide");
  if (mapping.liquidityScore < limits.minLiquidityScore) reasons.push("liquidity score is too low");
  if (signal.qualityScore !== undefined && signal.qualityScore !== null && signal.qualityScore < limits.minQualityScore) reasons.push("quality score is too low");
  if (signal.netEdge !== undefined && signal.netEdge !== null && signal.netEdge <= 0) reasons.push("net edge is not positive after execution costs");
  if ((signal.uncertaintyPenalty ?? 0) > limits.maxUncertaintyPenalty) reasons.push("forecast uncertainty or ensemble disagreement is too high");
  if ((signal.fillPenalty ?? 0) > limits.maxFillPenalty) reasons.push("expected fill quality is too low");
  if ((signal.diversificationPenalty ?? 0) > limits.maxDiversificationPenalty) reasons.push("portfolio diversification penalty is too high");
  if ((state.exposureByCorrelationKey?.[correlationKey] ?? 0) + signal.maxCost > limits.maxCorrelationExposure) reasons.push("correlated city/date/variable exposure would be exceeded");

  return { allowed: reasons.length === 0, reasons };
}

function secondsBetween(iso: string, now: Date) {
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
}
