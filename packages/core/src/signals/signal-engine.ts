import type { ForecastDelta, KalshiMarketCandidate, MarketMapping, ProbabilityEstimate, RiskCheckResult, Signal } from "../types.js";

export interface SignalConfig {
  minEdge: number;
  maxStake: number;
  maxLongshotPrice: number;
}

export const defaultSignalConfig: SignalConfig = {
  minEdge: 0.08,
  maxStake: 0.5,
  maxLongshotPrice: 0.15
};

export function generateSignal(
  delta: ForecastDelta,
  market: KalshiMarketCandidate,
  mapping: MarketMapping,
  probability: ProbabilityEstimate,
  risk: RiskCheckResult,
  config: SignalConfig = defaultSignalConfig,
  now = new Date()
): Signal {
  const yesAsk = market.yesAsk ?? (market.noBid !== null ? 1 - market.noBid : null);
  const reasons: string[] = [];
  if (!mapping.accepted || mapping.confidence !== "high") reasons.push("market mapping is not high confidence");
  if (!probability.passesModelFilters || probability.edge < config.minEdge) reasons.push("edge below threshold");
  if (yesAsk === null) reasons.push("no executable YES ask");
  if (!risk.allowed) reasons.push(...risk.reasons);

  const limitPrice = yesAsk ?? 1;
  const contracts = Math.max(1, Math.floor(config.maxStake / Math.max(limitPrice, 0.01)));
  const maxCost = Number((contracts * limitPrice).toFixed(2));
  const status = reasons.length === 0 ? "FIRED" : "SKIPPED";

  return {
    id: `sig_${market.ticker}_${Date.now()}`,
    marketTicker: market.ticker,
    side: "YES",
    action: "BUY",
    contracts,
    limitPrice,
    maxCost,
    edge: probability.edge,
    confidence: probability.confidence,
    explanation: `${delta.city} ${labelFor(mapping.variable)} forecast moved from ${delta.oldValue} to ${delta.newValue} for ${delta.targetDate}. Market threshold is ${mapping.thresholdOperator} ${mapping.threshold}. Current YES ask is $${limitPrice.toFixed(2)}. Model probability is ${(probability.yesProbability * 100).toFixed(1)}%. Estimated edge is ${(probability.edge * 100).toFixed(1)} percentage points. ${status === "FIRED" ? `Paper buy allowed: ${contracts} contracts, $${maxCost.toFixed(2)} max cost.` : `Trade skipped: ${reasons.join("; ")}.`}`,
    status,
    skipReason: status === "SKIPPED" ? reasons.join("; ") : null,
    linkedDeltaId: delta.id,
    createdAt: now.toISOString()
  };
}

function labelFor(variable: string) {
  return variable.replace("_", " ");
}
