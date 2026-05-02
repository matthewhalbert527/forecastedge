import { z } from "zod";
import { defaultRiskLimits } from "@forecastedge/core";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return value;
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_MODE: z.enum(["watch", "paper", "demo", "live"]).default("paper"),
  API_PORT: z.coerce.number().default(4000),
  PAPER_LEARNING_MODE: booleanFromEnv.default(false),
  RUN_BACKGROUND_WORKER: booleanFromEnv.default(true),
  RUN_ON_STARTUP: booleanFromEnv.default(true),
  BACKGROUND_POLL_INTERVAL_MINUTES: z.coerce.number().default(15).transform((minutes) => Math.min(minutes, 15)),
  RUN_QUOTE_REFRESH_WORKER: booleanFromEnv.default(true),
  QUOTE_REFRESH_INTERVAL_MINUTES: z.coerce.number().default(1).transform((minutes) => Math.max(1, minutes)),
  QUOTE_REFRESH_MAX_PAPER_ORDERS: z.coerce.number().default(3),
  SCHEDULED_JOB_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  DAILY_REPORT_EMAIL_TO: z.string().optional(),
  DAILY_REPORT_EMAIL_FROM: z.string().optional(),
  SCHEDULED_HISTORICAL_SERIES_TICKERS: z.string().default(""),
  SCHEDULED_HISTORICAL_LOOKBACK_DAYS: z.coerce.number().default(7).transform((days) => Math.min(Math.max(1, days), 30)),
  SCHEDULED_HISTORICAL_MAX_SERIES: z.coerce.number().default(1).transform((count) => Math.min(Math.max(1, count), 5)),
  SCHEDULED_HISTORICAL_MAX_MARKETS_PER_SERIES: z.coerce.number().default(10).transform((count) => Math.min(Math.max(1, count), 25)),
  STRATEGY_OPTIMIZER_MAX_RUNS: z.coerce.number().default(12).transform((count) => Math.min(Math.max(1, count), 30)),
  STRATEGY_OPTIMIZER_MIN_EDGE_GRID: z.string().default(""),
  STRATEGY_OPTIMIZER_MIN_LIQUIDITY_GRID: z.string().default(""),
  STRATEGY_OPTIMIZER_MAX_SPREAD_GRID: z.string().default(""),
  STRATEGY_OPTIMIZER_SLIPPAGE_CENTS_GRID: z.string().default(""),
  STRATEGY_OPTIMIZER_SELECTION_GRID: z.string().default("first_signal,best_quality,best_edge"),
  FORECAST_CACHE_MINUTES: z.coerce.number().default(45),
  OPEN_METEO_COOLDOWN_MINUTES: z.coerce.number().default(60),
  OPEN_METEO_BASE_URL: z.string().url().default("https://api.open-meteo.com/v1"),
  OPEN_METEO_GFS_BASE_URL: z.string().url().default("https://api.open-meteo.com/v1/gfs"),
  ENABLE_MODEL_STACK: booleanFromEnv.default(true),
  OPEN_METEO_ECMWF_MODEL: z.string().default("ecmwf_ifs025"),
  NWS_BASE_URL: z.string().url().default("https://api.weather.gov"),
  NWS_USER_AGENT: z.string().default("ForecastEdge/0.1 contact@example.com"),
  KALSHI_PROD_BASE_URL: z.string().url().default("https://api.elections.kalshi.com/trade-api/v2"),
  KALSHI_DEMO_BASE_URL: z.string().url().default("https://demo-api.kalshi.co/trade-api/v2"),
  KALSHI_WEATHER_SERIES_TICKERS: z.string().default("KXHIGHNY,KXHIGHMIA,KXHIGHCHI,KXHIGHAUS,KXHIGHLAX,KXHIGHOKC,KXHIGHBOS,KXHIGHPHIL,KXHIGHDEN,KXHIGHPHX,KXHIGHLAS,KXHIGHSEA,KXHIGHATL,KXHIGHDC,KXHIGHDAL,KXHIGHHOU"),
  ACCUWEATHER_BASE_URL: z.string().url().default("https://dataservice.accuweather.com"),
  ACCUWEATHER_API_KEY: z.string().optional(),
  NOAA_CDO_TOKEN: z.string().optional(),
  KALSHI_DEMO_ACCESS_KEY: z.string().optional(),
  KALSHI_DEMO_PRIVATE_KEY_PEM: z.string().optional(),
  KALSHI_PROD_ACCESS_KEY: z.string().optional(),
  KALSHI_PROD_PRIVATE_KEY_PEM: z.string().optional(),
  LIVE_TRADING_ENABLED: booleanFromEnv.default(false),
  REQUIRE_MANUAL_CONFIRMATION: booleanFromEnv.default(true),
  KILL_SWITCH_ENABLED: booleanFromEnv.default(true),
  MAX_STAKE_PER_TRADE_PAPER: z.coerce.number().default(defaultRiskLimits.maxStakePerTrade),
  MAX_DAILY_PAPER_LOSS: z.coerce.number().default(defaultRiskLimits.maxDailyLoss),
  MAX_OPEN_PAPER_EXPOSURE: z.coerce.number().default(defaultRiskLimits.maxOpenExposure),
  MAX_DAILY_TRADES: z.coerce.number().default(defaultRiskLimits.maxDailyTrades),
  MAX_SPREAD: z.coerce.number().default(defaultRiskLimits.maxSpread),
  MIN_EDGE_PERCENTAGE_POINTS: z.coerce.number().default(8),
  STALE_MARKET_DATA_SECONDS: z.coerce.number().default(defaultRiskLimits.staleMarketDataSeconds),
  STALE_FORECAST_DATA_MINUTES: z.coerce.number().default(defaultRiskLimits.staleForecastDataMinutes)
});

export const env = schema.parse(process.env);
export const listenPort = Number(process.env.PORT ?? env.API_PORT);

const paperLearningMode = env.APP_MODE === "paper" && env.PAPER_LEARNING_MODE;
const learningModeLargeLimit = 1_000_000;

export const activeRiskLimits = {
  ...defaultRiskLimits,
  maxStakePerTrade: env.MAX_STAKE_PER_TRADE_PAPER,
  maxDailyLoss: env.MAX_DAILY_PAPER_LOSS,
  maxDailyTrades: paperLearningMode ? learningModeLargeLimit : env.MAX_DAILY_TRADES,
  maxOpenExposure: paperLearningMode ? learningModeLargeLimit : env.MAX_OPEN_PAPER_EXPOSURE,
  maxExposurePerCity: paperLearningMode ? learningModeLargeLimit : defaultRiskLimits.maxExposurePerCity,
  maxExposurePerWeatherType: paperLearningMode ? learningModeLargeLimit : defaultRiskLimits.maxExposurePerWeatherType,
  maxOpenPositions: paperLearningMode ? learningModeLargeLimit : defaultRiskLimits.maxOpenPositions,
  maxSpread: env.MAX_SPREAD,
  maxUncertaintyPenalty: paperLearningMode ? 1 : defaultRiskLimits.maxUncertaintyPenalty,
  maxFillPenalty: paperLearningMode ? 1 : defaultRiskLimits.maxFillPenalty,
  maxDiversificationPenalty: paperLearningMode ? 1 : defaultRiskLimits.maxDiversificationPenalty,
  maxCorrelationExposure: paperLearningMode ? learningModeLargeLimit : defaultRiskLimits.maxCorrelationExposure,
  staleMarketDataSeconds: env.STALE_MARKET_DATA_SECONDS,
  staleForecastDataMinutes: env.STALE_FORECAST_DATA_MINUTES
};
