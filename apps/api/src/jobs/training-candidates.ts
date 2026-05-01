import {
  computeTradeQuality,
  estimateMarketProbability,
  type EnsembleForecast,
  type KalshiMarketCandidate,
  type MarketMapping,
  type Settlement,
  type TrainingCandidate
} from "@forecastedge/core";

export interface TrainingCandidateConfig {
  minEdge: number;
  minNetEdge: number;
  minQualityScore: number;
  maxSpread: number;
  minLiquidityScore: number;
  maxStake: number;
  maxContracts: number;
  maxEntryPrice?: number | null;
  learnedEdgeAdjustments?: LearnedEdgeAdjustment[];
}

export interface LearnedEdgeAdjustment {
  id: string;
  label: string;
  minEdgeAdjustment: number;
  reason: string;
  variable?: string | null;
}

const defaultConfig: TrainingCandidateConfig = {
  minEdge: 0.08,
  minNetEdge: 0.03,
  minQualityScore: 3,
  maxSpread: 0.1,
  minLiquidityScore: 0.01,
  maxStake: 0.5,
  maxContracts: 10
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
      const selectivity = selectivityFor(mapping, config);
      const probability = market
        ? estimateMarketProbability(
            mapping,
            {
              forecastValue,
              uncertaintyStdDev: ensemble?.uncertaintyStdDev ?? null,
              disagreement: ensemble?.disagreement ?? null,
              confidence: ensemble?.confidence ?? mapping.confidence
            },
            market,
            { sameDayTempStdDevF: 2, oneDayTempStdDevF: 3, multiDayTempStdDevF: 4.5, minEdge: selectivity.requiredEdge }
          )
        : null;
      const quality = probability
        ? computeTradeQuality({
            probability,
            entryPrice,
            spread,
            liquidityScore: mapping.liquidityScore,
            config: {
              minNetEdge: config.minNetEdge,
              minQualityScore: config.minQualityScore,
              maxStake: config.maxStake,
              maxContracts: config.maxContracts
            }
          })
        : null;
      const grossEdge = probability?.grossEdge ?? null;
      const netEdge = quality?.netEdge ?? null;
      const qualityScore = quality?.qualityScore ?? null;
      const blockers = blockersFor({ mapping, market, forecastValue, entryPrice, spread, grossEdge, netEdge, quality, config, selectivity });
      const status = statusFor({ blockers, grossEdge, netEdge, qualityScore, config });
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
        yesProbability: probability?.yesProbability ?? null,
        rawYesProbability: probability?.rawYesProbability ?? null,
        calibratedYesProbability: probability?.calibratedYesProbability ?? null,
        impliedProbability: probability?.impliedProbability ?? entryPrice,
        edge: grossEdge,
        grossEdge,
        expectedSlippage: quality?.expectedSlippage ?? null,
        spreadPenalty: quality?.spreadPenalty ?? null,
        feePenalty: quality?.feePenalty ?? null,
        netEdge,
        uncertaintyPenalty: quality?.uncertaintyPenalty ?? null,
        fillPenalty: quality?.fillPenalty ?? null,
        diversificationPenalty: quality?.diversificationPenalty ?? null,
        qualityScore,
        kellyFraction: quality?.kellyFraction ?? null,
        recommendedStake: quality?.recommendedStake ?? null,
        recommendedContracts: quality?.recommendedContracts ?? null,
        rankingReason: quality?.rankingReason ?? null,
        spread,
        liquidityScore: mapping.liquidityScore,
        status,
        blockers,
        settlementResult: settlement?.result ?? null,
        counterfactualPnl,
        reason: reasonFor(mapping, forecastValue, probability, entryPrice, blockers, settlement, counterfactualPnl, selectivity, quality),
        createdAt
      } satisfies TrainingCandidate;
    })
    .sort((a, b) => (b.qualityScore ?? -1) - (a.qualityScore ?? -1));
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

function blockersFor(input: {
  mapping: MarketMapping;
  market: KalshiMarketCandidate | undefined;
  forecastValue: number | null;
  entryPrice: number | null;
  spread: number | null;
  grossEdge: number | null;
  netEdge: number | null;
  quality: ReturnType<typeof computeTradeQuality> | null;
  config: TrainingCandidateConfig;
  selectivity: ReturnType<typeof selectivityFor>;
}) {
  const blockers: string[] = [];
  if (!input.mapping.accepted) blockers.push(input.mapping.reviewReason ?? "mapping is not accepted");
  if (!input.market) blockers.push("market quote is unavailable");
  if (input.mapping.threshold === null) blockers.push("market threshold is unknown");
  if (input.forecastValue === null) blockers.push("no ensemble forecast matched this market");
  if (input.entryPrice === null) blockers.push("no executable YES ask");
  if (input.entryPrice !== null && input.config.maxEntryPrice !== null && input.config.maxEntryPrice !== undefined && input.entryPrice > input.config.maxEntryPrice) blockers.push("entry price above learned cap");
  if (input.spread !== null && input.spread > input.config.maxSpread) blockers.push("spread is too wide");
  if (input.mapping.liquidityScore < input.config.minLiquidityScore) blockers.push("liquidity score is too low");
  if (input.grossEdge !== null && input.grossEdge < input.selectivity.requiredEdge) blockers.push(input.selectivity.requiredEdge > input.config.minEdge ? `gross edge below learned threshold (${percent(input.selectivity.requiredEdge)} required)` : "gross edge below threshold");
  if (input.netEdge !== null && input.netEdge < input.config.minNetEdge) blockers.push(`net edge below quality threshold (${percent(input.config.minNetEdge)} required)`);
  if (input.quality?.qualityScore !== null && input.quality?.qualityScore !== undefined && input.quality.qualityScore < input.config.minQualityScore) blockers.push(`quality score below threshold (${input.config.minQualityScore.toFixed(1)} required)`);
  if ((input.quality?.recommendedContracts ?? 0) <= 0) blockers.push("Kelly sizing recommends no fillable contracts");
  if (input.grossEdge === null) blockers.push("gross edge could not be calculated");
  return blockers;
}

function statusFor(input: { blockers: string[]; grossEdge: number | null; netEdge: number | null; qualityScore: number | null; config: TrainingCandidateConfig }): TrainingCandidate["status"] {
  if (input.blockers.length === 0 && (input.netEdge ?? -Infinity) >= input.config.minNetEdge && (input.qualityScore ?? -Infinity) >= input.config.minQualityScore) return "WOULD_BUY";
  if ((input.grossEdge ?? 0) > 0) return "WATCH";
  return "BLOCKED";
}

function reasonFor(
  mapping: MarketMapping,
  forecastValue: number | null,
  probability: ReturnType<typeof estimateMarketProbability> | null,
  entryPrice: number | null,
  blockers: string[],
  settlement: Settlement | null,
  counterfactualPnl: number | null,
  selectivity: ReturnType<typeof selectivityFor>,
  quality: ReturnType<typeof computeTradeQuality> | null
) {
  const base = [
    forecastValue === null || mapping.threshold === null ? "Forecast or threshold missing" : `${mapping.variable} forecast ${forecastValue.toFixed(2)} vs ${mapping.thresholdOperator} ${mapping.threshold}`,
    probability === null ? "probability unavailable" : `raw YES ${(probability.rawYesProbability * 100).toFixed(1)}%, calibrated YES ${(probability.calibratedYesProbability * 100).toFixed(1)}%`,
    entryPrice === null ? "entry unavailable" : `entry $${entryPrice.toFixed(2)}`,
    probability === null ? "gross edge unavailable" : `gross edge ${(probability.grossEdge * 100).toFixed(1)} pp`,
    quality?.netEdge === null || quality?.netEdge === undefined ? "net edge unavailable" : `net edge ${(quality.netEdge * 100).toFixed(1)} pp`,
    quality ? `penalties: slippage ${((quality.expectedSlippage ?? 0) * 100).toFixed(1)} pp, spread ${((quality.spreadPenalty ?? 0) * 100).toFixed(1)} pp, fee ${((quality.feePenalty ?? 0) * 100).toFixed(1)} pp, uncertainty ${((quality.uncertaintyPenalty ?? 0) * 100).toFixed(1)} pp, fill ${((quality.fillPenalty ?? 0) * 100).toFixed(1)} pp` : "quality unavailable",
    quality?.qualityScore === null || quality?.qualityScore === undefined ? "quality score unavailable" : `quality score ${quality.qualityScore.toFixed(2)}`,
    quality ? `recommended $${(quality.recommendedStake ?? 0).toFixed(2)} / ${quality.recommendedContracts ?? 0} contracts` : "recommended size unavailable"
  ];
  if (selectivity.rules.length > 0) base.push(`learned gross-edge threshold ${(selectivity.requiredEdge * 100).toFixed(1)} pp`);
  if (settlement && counterfactualPnl !== null) base.push(`settled ${settlement.result.toUpperCase()}, counterfactual P/L ${counterfactualPnl >= 0 ? "+" : ""}${counterfactualPnl.toFixed(2)}`);
  if (blockers.length > 0) base.push(`blocked by ${blockers.join("; ")}`);
  return base.join(". ");
}

function selectivityFor(mapping: MarketMapping, config: TrainingCandidateConfig) {
  const rules = (config.learnedEdgeAdjustments ?? []).filter((rule) => {
    if (rule.variable && rule.variable !== mapping.variable) return false;
    return true;
  });
  const adjustment = rules.reduce((sum, rule) => sum + Math.max(0, rule.minEdgeAdjustment), 0);
  return {
    requiredEdge: round(Math.min(0.35, config.minEdge + adjustment)),
    rules
  };
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)} pp`;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
