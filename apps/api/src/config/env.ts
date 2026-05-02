import { z } from "zod";
import { defaultRiskLimits } from "@forecastedge/core";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return value;
}, z.boolean());

const optionalSecret = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  return value;
}, z.string().optional());

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_MODE: z.enum(["watch", "paper", "demo", "live"]).default("paper"),
  API_PORT: z.coerce.number().default(4000),
  PAPER_LEARNING_MODE: booleanFromEnv.default(false),
  RUN_BACKGROUND_WORKER: booleanFromEnv.default(false),
  RUN_ON_STARTUP: booleanFromEnv.default(false),
  BACKGROUND_POLL_INTERVAL_MINUTES: z.coerce.number().default(15).transform((minutes) => clampInteger(minutes, 5, 120)),
  BACKGROUND_WORKER_MAX_RSS_MB: z.coerce.number().default(0).transform((mb) => clampInteger(mb, 0, 8192)),
  RUN_QUOTE_REFRESH_WORKER: booleanFromEnv.default(false),
  QUOTE_REFRESH_INTERVAL_MINUTES: z.coerce.number().default(5).transform((minutes) => clampInteger(minutes, 1, 60)),
  QUOTE_REFRESH_MAX_TICKERS: z.coerce.number().default(25).transform((count) => clampInteger(count, 1, 100)),
  QUOTE_REFRESH_MAX_PAPER_ORDERS: z.coerce.number().default(3).transform((count) => clampInteger(count, 1, 50)),
  RUN_LEARNING_CYCLE_WORKER: booleanFromEnv.default(false),
  LEARNING_CYCLE_INTERVAL_MINUTES: z.coerce.number().default(360).transform((minutes) => clampInteger(minutes, 60, 1440)),
  LEARNING_CYCLE_MIN_SETTLED_EXAMPLES: z.coerce.number().default(10).transform((count) => clampInteger(count, 0, 5000)),
  LEARNING_CYCLE_BACKTEST_LOOKBACK_DAYS: z.coerce.number().default(30).transform((days) => clampInteger(days, 1, 180)),
  FORECASTEDGE_API_TOKEN: optionalSecret,
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  SCHEDULED_JOB_TOKEN: optionalSecret,
  RESEND_API_KEY: optionalSecret,
  DAILY_REPORT_EMAIL_TO: z.string().optional(),
  DAILY_REPORT_EMAIL_FROM: z.string().optional(),
  OPENAI_API_KEY: optionalSecret,
  GPT_ANALYSIS_ENABLED: booleanFromEnv.default(false),
  GPT_ANALYSIS_MODEL: z.string().default("gpt-5.4-mini"),
  GPT_REVIEW_EMAIL_LAYERS: z.string().default("daily"),
  GPT_REVIEW_MAX_INPUT_CHARS: z.coerce.number().default(60_000).transform((chars) => clampInteger(chars, 10_000, 200_000)),
  GPT_AUTO_APPLY_PATCHES: booleanFromEnv.default(false),
  GPT_AUTO_APPLY_MIN_SETTLED_EXAMPLES: z.coerce.number().default(10).transform((count) => clampInteger(count, 10, 5000)),
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
  KALSHI_MARKET_DISCOVERY_LIMIT: z.coerce.number().default(100).transform((limit) => clampInteger(limit, 25, 200)),
  KALSHI_MARKET_DISCOVERY_MAX_PAGES: z.coerce.number().default(1).transform((pages) => clampInteger(pages, 1, 5)),
  ACCUWEATHER_BASE_URL: z.string().url().default("https://dataservice.accuweather.com"),
  ACCUWEATHER_API_KEY: optionalSecret,
  NOAA_CDO_TOKEN: optionalSecret,
  KALSHI_DEMO_ACCESS_KEY: optionalSecret,
  KALSHI_DEMO_PRIVATE_KEY_PEM: optionalSecret,
  KALSHI_PROD_ACCESS_KEY: optionalSecret,
  KALSHI_PROD_PRIVATE_KEY_PEM: optionalSecret,
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

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
