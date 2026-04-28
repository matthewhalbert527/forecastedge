import type { EnsembleForecast, KalshiMarketCandidate, MarketMapping, Settlement, TrainingCandidate } from "@forecastedge/core";

export interface TrainingCandidateConfig {
  minEdge: number;
  maxSpread: number;
  minLiquidityScore: number;
}

const defaultConfig: TrainingCandidateConfig = {
  minEdge: 0.08,
  maxSpread: 0.1,
  minLiquidityScore: 0.01
};

export function buildTrainingCandidates(input: {
  scanId: string;
  markets: KalshiMarketCandidate[];
  mappings: MarketMapping[];
  ensembles: EnsembleForecast[];
  settlements?: Settlement[];
  config?: Partial<TrainingCandidateConfig>;
}): TrainingCandidate[] {
  const config = { ...defaultConfig, ...input.config };
  const marketByTicker = new Map(input.markets.map((market) => [market.ticker, market]));
  const settlementByTicker = new Map((input.settlements ?? []).map((settlement) => [settlement.marketTicker, settlement]));
  const createdAt = new Date().toISOString();

  return input.mappings
    .slice(0, 200)
    .map((mapping) => {
      const market = marketByTicker.get(mapping.marketTicker);
      const ensemble = findEnsemble(mapping, input.ensembles);
      const settlement = settlementByTicker.get(mapping.marketTicker) ?? null;
      const entryPrice = market ? yesEntryPrice(market) : null;
      const spread = market ? yesSpread(market) : null;
      const forecastValue = ensemble?.prediction ?? null;
      const yesProbability = estimateYesProbability(mapping, forecastValue, ensemble?.uncertaintyStdDev ?? null);
      const impliedProbability = entryPrice;
      const edge = yesProbability !== null && impliedProbability !== null ? round(yesProbability - impliedProbability) : null;
      const blockers = blockersFor({ mapping, market, forecastValue, entryPrice, spread, edge, config });
      const status = blockers.length === 0 ? "WOULD_BUY" : edge !== null && edge > 0 ? "WATCH" : "BLOCKED";
      const counterfactualPnl = settlement && entryPrice !== null ? round((settlement.result === "yes" ? 1 : 0) - entryPrice) : null;

      return {
        id: `${input.scanId}_${mapping.marketTicker}`,
        scanId: input.scanId,
        marketTicker: mapping.marketTicker,
        title: mapping.title,
        city: mapping.location?.city ?? null,
        stationId: mapping.station?.stationId ?? null,
        variable: mapping.variable,
        targetDate: mapping.targetDate,
        threshold: mapping.threshold,
        thresholdOperator: mapping.thresholdOperator,
        forecastValue,
        entryPrice,
        yesProbability,
        impliedProbability,
        edge,
        spread,
        liquidityScore: mapping.liquidityScore,
        status,
        blockers,
        settlementResult: settlement?.result ?? null,
        counterfactualPnl,
        reason: reasonFor(mapping, forecastValue, yesProbability, entryPrice, edge, blockers, settlement, counterfactualPnl),
        createdAt
      } satisfies TrainingCandidate;
    })
    .sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
}

function findEnsemble(mapping: MarketMapping, ensembles: EnsembleForecast[]) {
  return ensembles.find((ensemble) => {
    const sameDate = mapping.targetDate === ensemble.targetDate;
    const sameVariable = mapping.variable === ensemble.variable;
    const sameStation = mapping.station?.stationId && mapping.station.stationId === ensemble.stationId;
    const sameCity = mapping.location?.city && mapping.location.city.toLowerCase() === ensemble.city.toLowerCase();
    return sameDate && sameVariable && Boolean(sameStation || sameCity);
  });
}

function yesEntryPrice(market: KalshiMarketCandidate) {
  return market.yesAsk ?? (market.noBid !== null ? round(1 - market.noBid) : null);
}

function yesSpread(market: KalshiMarketCandidate) {
  if (market.yesAsk === null || market.yesBid === null) return null;
  return round(market.yesAsk - market.yesBid);
}

function estimateYesProbability(mapping: MarketMapping, forecastValue: number | null, uncertaintyStdDev: number | null) {
  if (forecastValue === null || mapping.threshold === null) return null;

  if (mapping.variable === "high_temp" || mapping.variable === "low_temp") {
    const stdDev = Math.max(uncertaintyStdDev ?? 3, 1);
    const aboveProbability = normalCdf((forecastValue - mapping.threshold) / stdDev);
    return round(mapping.thresholdOperator === "below" ? 1 - aboveProbability : aboveProbability);
  }

  if (mapping.variable === "rainfall") {
    const ratio = Math.max(0, Math.min(1, forecastValue / Math.max(mapping.threshold, 0.01)));
    return round(Math.max(0.05, Math.min(0.75, ratio * 0.55 + 0.1)));
  }

  if (mapping.variable === "wind_gust") {
    const stdDev = Math.max(uncertaintyStdDev ?? 6, 2);
    return round(normalCdf((forecastValue - mapping.threshold) / stdDev));
  }

  return null;
}

function blockersFor(input: {
  mapping: MarketMapping;
  market: KalshiMarketCandidate | undefined;
  forecastValue: number | null;
  entryPrice: number | null;
  spread: number | null;
  edge: number | null;
  config: TrainingCandidateConfig;
}) {
  const blockers: string[] = [];
  if (!input.mapping.accepted) blockers.push(input.mapping.reviewReason ?? "mapping is not accepted");
  if (!input.market) blockers.push("market quote is unavailable");
  if (input.mapping.threshold === null) blockers.push("market threshold is unknown");
  if (input.forecastValue === null) blockers.push("no ensemble forecast matched this market");
  if (input.entryPrice === null) blockers.push("no executable YES ask");
  if (input.spread !== null && input.spread > input.config.maxSpread) blockers.push("spread is too wide");
  if (input.mapping.liquidityScore < input.config.minLiquidityScore) blockers.push("liquidity score is too low");
  if (input.edge !== null && input.edge < input.config.minEdge) blockers.push("edge below threshold");
  if (input.edge === null) blockers.push("edge could not be calculated");
  return blockers;
}

function reasonFor(
  mapping: MarketMapping,
  forecastValue: number | null,
  yesProbability: number | null,
  entryPrice: number | null,
  edge: number | null,
  blockers: string[],
  settlement: Settlement | null,
  counterfactualPnl: number | null
) {
  const base = [
    forecastValue === null || mapping.threshold === null ? "Forecast or threshold missing" : `${mapping.variable} forecast ${forecastValue.toFixed(2)} vs ${mapping.thresholdOperator} ${mapping.threshold}`,
    yesProbability === null ? "model probability unavailable" : `model YES ${(yesProbability * 100).toFixed(1)}%`,
    entryPrice === null ? "entry unavailable" : `entry $${entryPrice.toFixed(2)}`,
    edge === null ? "edge unavailable" : `edge ${(edge * 100).toFixed(1)} pp`
  ];
  if (settlement && counterfactualPnl !== null) base.push(`settled ${settlement.result.toUpperCase()}, counterfactual P/L ${counterfactualPnl >= 0 ? "+" : ""}${counterfactualPnl.toFixed(2)}`);
  if (blockers.length > 0) base.push(`blocked by ${blockers.join("; ")}`);
  return base.join(". ");
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
