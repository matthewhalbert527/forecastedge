import type { ForecastDelta, KalshiMarketCandidate, MarketMapping, ProbabilityEstimate, RiskCheckResult, Signal } from "../types.js";
import { computeTradeQuality } from "../trading/trade-quality.js";

export interface SignalConfig {
  minEdge: number;
  minNetEdge: number;
  minQualityScore: number;
  maxStake: number;
  maxContracts: number;
  maxLongshotPrice: number;
}

export const defaultSignalConfig: SignalConfig = {
  minEdge: 0.08,
  minNetEdge: 0.03,
  minQualityScore: 3,
  maxStake: 0.5,
  maxContracts: 10,
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
  const spread = market.yesAsk !== null && market.yesBid !== null ? market.yesAsk - market.yesBid : null;
  const quality = computeTradeQuality({
    probability,
    entryPrice: yesAsk,
    spread,
    liquidityScore: mapping.liquidityScore,
    config: {
      minNetEdge: config.minNetEdge,
      minQualityScore: config.minQualityScore,
      maxStake: config.maxStake,
      maxContracts: config.maxContracts
    }
  });
  const reasons: string[] = [];
  if (!mapping.accepted || mapping.confidence !== "high") reasons.push("market mapping is not high confidence");
  if (!probability.passesModelFilters || probability.grossEdge < config.minEdge) reasons.push("gross edge below threshold");
  if ((quality.netEdge ?? -Infinity) < config.minNetEdge) reasons.push("net edge below quality threshold");
  if ((quality.qualityScore ?? -Infinity) < config.minQualityScore) reasons.push("quality score below threshold");
  if ((quality.recommendedContracts ?? 0) <= 0) reasons.push("Kelly sizing recommends no fillable contracts");
  if (yesAsk === null) reasons.push("no executable YES ask");
  if (!risk.allowed) reasons.push(...risk.reasons);

  const limitPrice = yesAsk ?? 1;
  const contracts = Math.max(0, Math.min(config.maxContracts, quality.recommendedContracts ?? 0));
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
    edge: probability.grossEdge,
    rawYesProbability: probability.rawYesProbability,
    calibratedYesProbability: probability.calibratedYesProbability,
    grossEdge: probability.grossEdge,
    expectedSlippage: quality.expectedSlippage,
    spreadPenalty: quality.spreadPenalty,
    feePenalty: quality.feePenalty,
    netEdge: quality.netEdge,
    uncertaintyPenalty: quality.uncertaintyPenalty,
    fillPenalty: quality.fillPenalty,
    diversificationPenalty: quality.diversificationPenalty,
    qualityScore: quality.qualityScore,
    kellyFraction: quality.kellyFraction,
    recommendedStake: quality.recommendedStake,
    recommendedContracts: quality.recommendedContracts,
    rankingReason: quality.rankingReason,
    confidence: probability.confidence,
    explanation: `${delta.city} ${labelFor(mapping.variable)} forecast moved from ${delta.oldValue} to ${delta.newValue} for ${delta.targetDate}. Market threshold is ${mapping.thresholdOperator} ${mapping.threshold}. Current YES ask is $${limitPrice.toFixed(2)}. Raw probability ${(probability.rawYesProbability * 100).toFixed(1)}%, calibrated probability ${(probability.calibratedYesProbability * 100).toFixed(1)}%. Gross edge ${(probability.grossEdge * 100).toFixed(1)} pp, net edge ${((quality.netEdge ?? 0) * 100).toFixed(1)} pp. Penalties: slippage ${((quality.expectedSlippage ?? 0) * 100).toFixed(1)} pp, spread ${((quality.spreadPenalty ?? 0) * 100).toFixed(1)} pp, fee ${((quality.feePenalty ?? 0) * 100).toFixed(1)} pp, uncertainty ${((quality.uncertaintyPenalty ?? 0) * 100).toFixed(1)} pp, fill ${((quality.fillPenalty ?? 0) * 100).toFixed(1)} pp. Quality score ${quality.qualityScore?.toFixed(2) ?? "n/a"}. ${status === "FIRED" ? `Paper buy allowed: ${contracts} contracts, $${maxCost.toFixed(2)} max cost.` : `Trade skipped: ${reasons.join("; ")}.`}`,
    status,
    skipReason: status === "SKIPPED" ? reasons.join("; ") : null,
    linkedDeltaId: delta.id,
    createdAt: now.toISOString()
  };
}

function labelFor(variable: string) {
  return variable.replace("_", " ");
}
