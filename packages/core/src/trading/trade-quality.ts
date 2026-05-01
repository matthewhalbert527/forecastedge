import type { ProbabilityEstimate, TradeQualityFields } from "../types.js";

export interface TradeQualityConfig {
  minNetEdge: number;
  minQualityScore: number;
  maxStake: number;
  maxContracts: number;
  fractionalKelly: number;
  kellyStakeScale: number;
  defaultFeePenalty: number;
  defaultSlippage: number;
}

export interface TradeQualityInput {
  probability: ProbabilityEstimate;
  entryPrice: number | null;
  spread: number | null;
  liquidityScore: number;
  diversificationPenalty?: number | null;
  config?: Partial<TradeQualityConfig>;
}

export const defaultTradeQualityConfig: TradeQualityConfig = {
  minNetEdge: 0.03,
  minQualityScore: 3,
  maxStake: 0.5,
  maxContracts: 10,
  fractionalKelly: 0.25,
  // maxStake is a per-trade cap, not total bankroll; this converts Kelly into cap utilization.
  kellyStakeScale: 0.05,
  defaultFeePenalty: 0.0025,
  defaultSlippage: 0.005
};

export function computeTradeQuality(input: TradeQualityInput): TradeQualityFields {
  const config = { ...defaultTradeQualityConfig, ...input.config };
  const entryPrice = input.entryPrice;
  const spread = input.spread ?? 0.25;
  const calibrated = input.probability.calibratedYesProbability;
  const grossEdge = entryPrice === null ? null : round(calibrated - entryPrice);
  const expectedSlippage = entryPrice === null ? null : round(Math.max(config.defaultSlippage, spread * 0.25));
  const spreadPenalty = round(Math.max(0, spread * 0.35));
  const feePenalty = round(config.defaultFeePenalty);
  const netEdge = entryPrice === null || expectedSlippage === null
    ? null
    : round(calibrated - entryPrice - expectedSlippage - spreadPenalty - feePenalty);
  const uncertaintyPenalty = round(uncertaintyPenaltyFor(input.probability.uncertaintyStdDev, input.probability.disagreement));
  const fillPenalty = round(fillPenaltyFor(input.liquidityScore, spread));
  const diversificationPenalty = round(clamp(input.diversificationPenalty ?? 0, 0, 0.25));
  const adjustedEdge = netEdge === null ? null : round(netEdge - uncertaintyPenalty - fillPenalty - diversificationPenalty);
  const qualityScore = adjustedEdge === null ? null : round(Math.max(0, adjustedEdge * 100));
  const kellyFraction = entryPrice === null || netEdge === null
    ? null
    : fractionalKellyForBinary(calibrated, entryPrice, netEdge, config.fractionalKelly, uncertaintyPenalty, diversificationPenalty);
  const recommendedStake = entryPrice === null || kellyFraction === null || qualityScore === null || qualityScore <= 0
    ? 0
    : round(Math.min(config.maxStake, config.maxStake * Math.min(1, kellyFraction / Math.max(config.kellyStakeScale, 0.001))));
  const rawContracts = entryPrice === null || recommendedStake <= 0 ? 0 : Math.floor(recommendedStake / Math.max(entryPrice, 0.01));
  const liquidityCap = Math.max(1, Math.floor(config.maxContracts * clamp(input.liquidityScore, 0.1, 1)));
  const recommendedContracts = entryPrice !== null && rawContracts === 0 && recommendedStake >= entryPrice * 0.75
    ? 1
    : Math.max(0, rawContracts);
  const cappedContracts = Math.min(config.maxContracts, liquidityCap, recommendedContracts);

  return {
    rawYesProbability: input.probability.rawYesProbability,
    calibratedYesProbability: calibrated,
    grossEdge,
    expectedSlippage,
    spreadPenalty,
    feePenalty,
    netEdge,
    uncertaintyPenalty,
    fillPenalty,
    diversificationPenalty,
    qualityScore,
    kellyFraction,
    recommendedStake,
    recommendedContracts: cappedContracts,
    rankingReason: rankingReason({
      grossEdge,
      netEdge,
      qualityScore,
      expectedSlippage,
      spreadPenalty,
      feePenalty,
      uncertaintyPenalty,
      fillPenalty,
      diversificationPenalty,
      recommendedStake,
      recommendedContracts: cappedContracts
    })
  };
}

export function fractionalKellyForBinary(
  winProbability: number,
  entryPrice: number,
  netEdge: number,
  fractionalKelly = defaultTradeQualityConfig.fractionalKelly,
  uncertaintyPenalty = 0,
  diversificationPenalty = 0
) {
  if (entryPrice <= 0 || entryPrice >= 1 || netEdge <= 0 || winProbability <= entryPrice) return 0;
  const fullKelly = clamp(netEdge / Math.max(1 - entryPrice, 0.01), 0, 1);
  const shrink = clamp(1 - uncertaintyPenalty - diversificationPenalty, 0, 1);
  return round(fullKelly * fractionalKelly * shrink);
}

function uncertaintyPenaltyFor(uncertaintyStdDev: number | null, disagreement: number | null) {
  const uncertainty = uncertaintyStdDev === null ? 0.015 : clamp(uncertaintyStdDev / 30, 0, 0.18);
  const disagreementPenalty = disagreement === null ? 0 : clamp(disagreement / 2, 0, 0.12);
  return uncertainty + disagreementPenalty;
}

function fillPenaltyFor(liquidityScore: number, spread: number) {
  const liquidityPenalty = clamp((0.15 - liquidityScore) * 0.18, 0, 0.06);
  const spreadFillPenalty = clamp(Math.max(0, spread - 0.03) * 0.2, 0, 0.06);
  return liquidityPenalty + spreadFillPenalty;
}

function rankingReason(input: {
  grossEdge: number | null;
  netEdge: number | null;
  qualityScore: number | null;
  expectedSlippage: number | null;
  spreadPenalty: number | null;
  feePenalty: number | null;
  uncertaintyPenalty: number | null;
  fillPenalty: number | null;
  diversificationPenalty: number | null;
  recommendedStake: number | null;
  recommendedContracts: number | null;
}) {
  return [
    input.grossEdge === null ? "gross edge unavailable" : `gross edge ${percent(input.grossEdge)}`,
    input.netEdge === null ? "net edge unavailable" : `net edge ${percent(input.netEdge)}`,
    `penalties slippage ${percent(input.expectedSlippage)}, spread ${percent(input.spreadPenalty)}, fee ${percent(input.feePenalty)}, uncertainty ${percent(input.uncertaintyPenalty)}, fill ${percent(input.fillPenalty)}, diversification ${percent(input.diversificationPenalty)}`,
    input.qualityScore === null ? "quality n/a" : `quality ${input.qualityScore.toFixed(2)}`,
    `size $${(input.recommendedStake ?? 0).toFixed(2)} / ${input.recommendedContracts ?? 0} contracts`
  ].join("; ");
}

function percent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)} pp`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function round(value: number) {
  return Number(value.toFixed(4));
}
