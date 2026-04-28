export type AppMode = "watch" | "paper" | "demo" | "live";
export type WeatherVariable = "high_temp" | "low_temp" | "rainfall" | "snowfall" | "wind_gust" | "humidity";
export type Confidence = "low" | "medium" | "high";
export type OrderSide = "YES" | "NO";
export type OrderAction = "BUY" | "SELL";
export type SettlementSource = "nws_daily_climate_report" | "nws_asos" | "accuweather" | "unknown";
export type ForecastModelSource = "open_meteo_global" | "ecmwf_ifs" | "hrrr" | "meteomatics_us1k" | "graphcast" | "gencast" | "weathermesh4" | "earth2" | "icon";

export interface SettlementStation {
  id: string;
  city: string;
  state: string;
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  nwsOffice?: string | undefined;
  accuweatherLocationKey?: string | undefined;
  aliases: string[];
  settlementSource: SettlementSource;
  notes: string;
}

export interface LocationConfig {
  id: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  timezone: string;
  pollingIntervalMinutes: number;
  stationId?: string | undefined;
  stationName?: string | undefined;
  settlementSource?: SettlementSource | undefined;
  accuweatherLocationKey?: string | undefined;
}

export interface NormalizedDailyForecast {
  targetDate: string;
  highTempF: number | null;
  lowTempF: number | null;
  precipitationProbabilityPct: number | null;
  precipitationAmountIn: number | null;
  snowAmountIn: number | null;
  windSpeedMph: number | null;
  windGustMph: number | null;
}

export interface NormalizedForecastSnapshot {
  id: string;
  provider: "open_meteo" | "nws" | "nws_station" | "accuweather";
  location: LocationConfig;
  forecastRunAt: string;
  hourly: Array<{
    time: string;
    temperatureF: number | null;
    precipitationProbabilityPct: number | null;
    precipitationAmountIn: number | null;
    snowAmountIn: number | null;
    windSpeedMph: number | null;
    windGustMph: number | null;
    humidityPct: number | null;
  }>;
  daily: NormalizedDailyForecast[];
  rawPayload: unknown;
  createdAt: string;
}

export interface ForecastDelta {
  id: string;
  locationId: string;
  city: string;
  state: string;
  provider: string;
  variable: WeatherVariable;
  targetDate: string;
  oldValue: number;
  newValue: number;
  absoluteChange: number;
  probabilityChange: number | null;
  timeHorizonHours: number;
  confidence: Confidence;
  reason: string;
  createdAt: string;
}

export interface KalshiMarketCandidate {
  ticker: string;
  eventTicker: string;
  title: string;
  subtitle?: string | undefined;
  closeTime?: string | undefined;
  settlementTime?: string | undefined;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  volume: number | null;
  openInterest: number | null;
  rawPayload: unknown;
}

export interface KalshiMarketDetails extends KalshiMarketCandidate {
  status: string | null;
  result: "yes" | "no" | "scalar" | "" | null;
  canSettle: boolean;
}

export interface MarketMapping {
  marketTicker: string;
  eventTicker: string;
  title: string;
  location: { city: string; state?: string | undefined } | null;
  station: SettlementStation | null;
  settlementSource: SettlementSource;
  variable: WeatherVariable | "hurricane" | "unknown";
  threshold: number | null;
  thresholdOperator: "above" | "below" | "between" | "unknown";
  targetDate: string | null;
  confidence: Confidence;
  accepted: boolean;
  reviewReason: string | null;
  liquidityScore: number;
}

export interface OrderBookLevel {
  price: number;
  contracts: number;
}

export interface NormalizedOrderBook {
  marketTicker: string;
  yesBids: OrderBookLevel[];
  noBids: OrderBookLevel[];
  observedAt: string;
}

export interface ProbabilityEstimate {
  marketTicker: string;
  yesProbability: number;
  noProbability: number;
  impliedProbability: number;
  edge: number;
  confidence: Confidence;
  reason: string;
  passesModelFilters: boolean;
}

export interface TrainingCandidate {
  id: string;
  scanId: string;
  marketTicker: string;
  title: string;
  city: string | null;
  stationId: string | null;
  variable: WeatherVariable | "hurricane" | "unknown";
  targetDate: string | null;
  threshold: number | null;
  thresholdOperator: MarketMapping["thresholdOperator"];
  forecastValue: number | null;
  entryPrice: number | null;
  yesProbability: number | null;
  impliedProbability: number | null;
  edge: number | null;
  spread: number | null;
  liquidityScore: number;
  status: "WOULD_BUY" | "WATCH" | "BLOCKED";
  blockers: string[];
  settlementResult: "yes" | "no" | null;
  counterfactualPnl: number | null;
  reason: string;
  createdAt: string;
}

export interface Signal {
  id: string;
  marketTicker: string;
  side: OrderSide;
  action: OrderAction;
  contracts: number;
  limitPrice: number;
  maxCost: number;
  edge: number;
  confidence: Confidence;
  explanation: string;
  status: "FIRED" | "SKIPPED";
  skipReason: string | null;
  linkedDeltaId: string;
  createdAt: string;
}

export interface RiskLimits {
  maxStakePerTrade: number;
  maxContractsPerTrade: number;
  maxDailyLoss: number;
  maxDailyTrades: number;
  maxOpenExposure: number;
  maxExposurePerCity: number;
  maxExposurePerWeatherType: number;
  maxOpenPositions: number;
  cooldownLossCount: number;
  staleMarketDataSeconds: number;
  staleForecastDataMinutes: number;
  maxSpread: number;
  minLiquidityScore: number;
}

export interface RiskState {
  realizedPnlToday: number;
  tradesToday: number;
  openExposure: number;
  openPositions: number;
  losingStreak: number;
  exposureByCity: Record<string, number>;
  exposureByWeatherType: Record<string, number>;
}

export interface RiskCheckResult {
  allowed: boolean;
  reasons: string[];
}

export interface PaperOrder {
  id: string;
  timestamp: string;
  marketTicker: string;
  side: OrderSide;
  action: OrderAction;
  requestedContracts: number;
  limitPrice: number;
  simulatedAvgFillPrice: number | null;
  filledContracts: number;
  unfilledContracts: number;
  status: "FILLED" | "PARTIAL" | "REJECTED" | "CANCELLED";
  reason: string;
  linkedSignalId: string;
}

export interface PaperPosition {
  id?: string;
  marketTicker: string;
  side: OrderSide;
  contracts: number;
  avgEntryPrice: number;
  realizedPnl: number;
  markPrice: number | null;
  openedAt?: string;
  closedAt?: string | null;
  settlementId?: string | null;
}

export interface Settlement {
  id: string;
  marketTicker: string;
  result: "yes" | "no";
  settledPrice: number;
  source: string;
  rawPayload: unknown;
  createdAt: string;
}

export interface ModelForecastPoint {
  id: string;
  locationId: string;
  city: string;
  state: string;
  stationId: string | null;
  model: ForecastModelSource;
  modelRunAt: string;
  forecastValidAt: string;
  targetDate: string;
  horizonHours: number;
  highTempF: number | null;
  lowTempF: number | null;
  precipitationAmountIn: number | null;
  precipitationProbabilityPct: number | null;
  windGustMph: number | null;
  uncertaintyStdDevF: number | null;
  freshnessMinutes: number;
  confidence: Confidence;
  rawPayload: unknown;
  createdAt: string;
}

export interface EnsembleForecast {
  id: string;
  locationId: string;
  city: string;
  state: string;
  stationId: string | null;
  targetDate: string;
  variable: Extract<WeatherVariable, "high_temp" | "low_temp" | "rainfall" | "wind_gust">;
  prediction: number | null;
  uncertaintyStdDev: number | null;
  confidence: Confidence;
  contributingModels: string[];
  disagreement: number | null;
  reason: string;
  createdAt: string;
}

export interface PaperPerformanceSummary {
  totalTrades: number;
  simulatedContracts: number;
  averageEntryPrice: number;
  totalCost: number;
  rejectedOrders: number;
  realizedPnl: number;
  unrealizedExposure: number;
  winRate: number;
  roi: number;
  maxDrawdown: number;
  longestLosingStreak: number;
  settledTrades: number;
  openPositions: number;
}
