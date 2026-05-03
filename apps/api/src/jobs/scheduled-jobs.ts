import { env } from "../config/env.js";
import { runGptDecisionReview, type GptDecisionReviewLayer } from "../ai/gpt-decision-review.js";
import type { PersistentStore } from "../data/persistent-store.js";
import {
  getHistoricalMarketCandlesticks,
  getHistoricalMarkets,
  getHistoricalTrades,
  isPlausibleWeatherMarket
} from "../kalshi/client.js";
import { sendDailyAlphaEmail } from "../notifications/daily-report-email.js";
import type { ForecastEdgePipeline } from "./pipeline.js";

export type ScheduledJobId =
  | "refresh_historical_market_data"
  | "refresh_forecast_archive_data"
  | "optimize_strategy_candidates"
  | "run_counterfactual_replay"
  | "run_nightly_backtests"
  | "update_paper_strategy_performance"
  | "generate_strategy_health_report"
  | "run_gpt_intraday_review"
  | "run_gpt_deep_review"
  | "run_gpt_daily_review";

export interface ScheduledJobRun {
  jobId: ScheduledJobId;
  status: "completed" | "skipped" | "failed";
  startedAt: string;
  completedAt: string;
  message: string;
  metadata: Record<string, unknown>;
}

interface ScheduledJobDefinition {
  id: ScheduledJobId;
  label: string;
  description: string;
  run: () => Promise<ScheduledJobRun>;
}

export class ScheduledJobRegistry {
  private readonly running = new Set<ScheduledJobId>();
  private readonly lastRuns = new Map<ScheduledJobId, ScheduledJobRun>();

  constructor(private readonly definitions: ScheduledJobDefinition[]) {}

  list() {
    return this.definitions.map((definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      running: this.running.has(definition.id),
      lastRun: this.lastRuns.get(definition.id) ?? null
    }));
  }

  async run(jobId: string) {
    const definition = this.definitions.find((candidate) => candidate.id === jobId);
    if (!definition) return null;
    if (this.running.has(definition.id)) {
      return jobRun(definition.id, "skipped", `${definition.label} is already running`, {});
    }
    this.running.add(definition.id);
    try {
      const result = await definition.run();
      this.lastRuns.set(definition.id, result);
      return result;
    } catch (error) {
      const result = jobRun(definition.id, "failed", error instanceof Error ? error.message : "Unknown scheduled job error", {});
      this.lastRuns.set(definition.id, result);
      return result;
    } finally {
      this.running.delete(definition.id);
    }
  }
}

export function createScheduledJobRegistry(deps: {
  pipeline: ForecastEdgePipeline;
  persistentStore: () => PersistentStore | null;
}) {
  const definitions: ScheduledJobDefinition[] = [
    {
      id: "refresh_historical_market_data",
      label: "Refresh historical market data",
      description: "Pull recent historical markets, candles, and trades for configured series.",
      run: async () => refreshHistoricalMarketData(deps.persistentStore())
    },
    {
      id: "refresh_forecast_archive_data",
      label: "Refresh forecast archive data",
      description: "Run the normal forecast/model scan once for archival snapshots.",
      run: async () => {
        const summary = await deps.pipeline.runOnce("scheduled");
        return jobRun("refresh_forecast_archive_data", "completed", "Forecast archive refresh completed", {
          locations: Array.isArray(summary.locations) ? summary.locations.length : 0
        });
      }
    },
    {
      id: "optimize_strategy_candidates",
      label: "Optimize strategy candidates",
      description: "Run a bounded champion/challenger parameter search and persist every challenger version.",
      run: async () => {
        const report = await deps.pipeline.runStrategyOptimizer({
          trigger: "scheduled_3am",
          validationMode: "walk_forward"
        });
        const status = report.status === "failed" ? "failed" : report.status === "skipped" ? "skipped" : "completed";
        return jobRun("optimize_strategy_candidates", status, report.recommendation, {
          optimizerRunId: report.id,
          champion: report.champion,
          bestCandidate: report.bestCandidate,
          challengers: report.challengers.length
        });
      }
    },
    {
      id: "run_counterfactual_replay",
      label: "Run counterfactual replay",
      description: "Replay stored WOULD_BUY, WATCH, and near-miss candidate snapshots against historical prices and settlements.",
      run: async () => {
        const window = centralDateWindow(30);
        const report = await deps.pipeline.runCounterfactualReplay({
          trigger: "scheduled_counterfactual_replay",
          validationMode: "walk_forward",
          slippageCents: 2,
          startDate: window.startDate,
          endDate: window.endDate,
          lookbackDays: 30
        });
        const best = report.bestCandidate as { optimizerCandidateId?: string; evaluatedMarkets?: number; roi?: number; totalPnl?: number } | null;
        const status = report.status === "failed" ? "failed" : report.status === "skipped" ? "skipped" : "completed";
        return jobRun("run_counterfactual_replay", status, report.recommendation, {
          replayRunId: report.id,
          window,
          bestCandidate: best?.optimizerCandidateId ?? null,
          evaluatedMarkets: best?.evaluatedMarkets ?? null,
          roi: best?.roi ?? null,
          totalPnl: best?.totalPnl ?? null,
          challengers: report.challengers.length
        });
      }
    },
    {
      id: "run_nightly_backtests",
      label: "Run nightly backtests",
      description: "Replay baseline and alpha-selective rules, then report hypothetical P/L.",
      run: async () => {
        const reportDate = previousCentralDate();
        const result = await deps.pipeline.runDailyAlphaReport({
          trigger: "scheduled_daily_alpha_report",
          validationMode: "walk_forward",
          slippageCents: 2,
          startDate: reportDate,
          endDate: reportDate
        });
        const best = result.bestCandidate as { evaluatedMarkets?: number; roi?: number; totalPnl?: number } | null;
        const status = result.status === "failed" ? "failed" : result.status === "skipped" ? "skipped" : "completed";
        const email = status === "skipped"
          ? { sent: false, reason: result.recommendation }
          : await sendDailyAlphaEmail({
              reportDate,
              recommendation: result.recommendation,
              champion: result.champion as Parameters<typeof sendDailyAlphaEmail>[0]["champion"],
              bestCandidate: result.bestCandidate as Parameters<typeof sendDailyAlphaEmail>[0]["bestCandidate"],
              challengers: result.challengers as Parameters<typeof sendDailyAlphaEmail>[0]["challengers"]
            });
        return jobRun("run_nightly_backtests", status, result.recommendation, {
          runId: result.id,
          reportDate,
          evaluatedMarkets: best?.evaluatedMarkets ?? null,
          roi: best?.roi ?? null,
          totalPnl: best?.totalPnl ?? null,
          email
        });
      }
    },
    {
      id: "update_paper_strategy_performance",
      label: "Update paper strategy performance",
      description: "Recompute paper-trade performance and degradation against backtest expectations.",
      run: async () => {
        const learning = await deps.pipeline.learningSummary();
        return jobRun("update_paper_strategy_performance", "completed", "Paper strategy performance refreshed", {
          paperTradeExamples: learning.collection.paperTradeExamples,
          settledPaperTradeExamples: learning.collection.settledPaperTradeExamples
        });
      }
    },
    {
      id: "generate_strategy_health_report",
      label: "Generate strategy health report",
      description: "Summarize approved, rejected, paper-testing, and warning states for review.",
      run: async () => {
        const dashboard = await deps.pipeline.strategyDecisionDashboard();
        return jobRun("generate_strategy_health_report", "completed", "Strategy health report generated", {
          statuses: dashboard.statuses,
          warnings: dashboard.warningsRequiringReview.length
        });
      }
    },
    {
      id: "run_gpt_intraday_review",
      label: "Run GPT intraday decision review",
      description: "Hourly behavior review of recent buys, watches, blockers, and suspicious choices. Never auto-applies patches.",
      run: async () => gptReviewJob("run_gpt_intraday_review", "intraday", deps)
    },
    {
      id: "run_gpt_deep_review",
      label: "Run GPT deep decision review",
      description: "Six-hour GPT review with deterministic counterfactuals when enough settled data exists.",
      run: async () => gptReviewJob("run_gpt_deep_review", "deep", deps)
    },
    {
      id: "run_gpt_daily_review",
      label: "Run GPT daily decision review",
      description: "Daily GPT recap email and bounded autonomous strategy-config patch when gates pass.",
      run: async () => gptReviewJob("run_gpt_daily_review", "daily", deps)
    }
  ];
  return new ScheduledJobRegistry(definitions);
}

async function gptReviewJob(
  jobId: ScheduledJobId,
  layer: GptDecisionReviewLayer,
  deps: { pipeline: ForecastEdgePipeline; persistentStore: () => PersistentStore | null }
) {
  const result = await runGptDecisionReview({
    layer,
    pipeline: deps.pipeline,
    persistentStore: deps.persistentStore()
  });
  return jobRun(jobId, result.status, result.message, result.metadata);
}

async function refreshHistoricalMarketData(persistentStore: PersistentStore | null) {
  if (!persistentStore) {
    return jobRun("refresh_historical_market_data", "skipped", "DATABASE_URL is required for historical data refresh", {});
  }
  const seriesTickers = env.SCHEDULED_HISTORICAL_SERIES_TICKERS.split(",").map((item) => item.trim()).filter(Boolean);
  if (seriesTickers.length === 0) {
    return jobRun("refresh_historical_market_data", "skipped", "SCHEDULED_HISTORICAL_SERIES_TICKERS is not configured", {});
  }

  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - Math.max(1, env.SCHEDULED_HISTORICAL_LOOKBACK_DAYS) * 24 * 60 * 60;
  let markets = 0;
  let candlesticks = 0;
  let trades = 0;

  for (const seriesTicker of seriesTickers.slice(0, env.SCHEDULED_HISTORICAL_MAX_SERIES)) {
    const discovered = (await getHistoricalMarkets({ seriesTicker, maxPages: 1 })).filter(isPlausibleWeatherMarket);
    await persistentStore.persistHistoricalMarkets(discovered);
    markets += discovered.length;
    for (const market of discovered.slice(0, env.SCHEDULED_HISTORICAL_MAX_MARKETS_PER_SERIES)) {
      const candleRows = await getHistoricalMarketCandlesticks(market.ticker, { startTs, endTs, periodInterval: 60 });
      await persistentStore.persistMarketCandlesticks(candleRows, "historical", 60);
      candlesticks += candleRows.length;
      const tradeRows = await getHistoricalTrades({ ticker: market.ticker, minTs: startTs, maxTs: endTs, maxPages: 1 });
      await persistentStore.persistMarketTrades(tradeRows, "historical");
      trades += tradeRows.length;
    }
  }

  return jobRun("refresh_historical_market_data", "completed", "Historical market data refreshed", {
    markets,
    candlesticks,
    trades,
    startTs,
    endTs
  });
}

function jobRun(jobId: ScheduledJobId, status: ScheduledJobRun["status"], message: string, metadata: Record<string, unknown>): ScheduledJobRun {
  const now = new Date().toISOString();
  return {
    jobId,
    status,
    startedAt: now,
    completedAt: now,
    message,
    metadata
  };
}

function previousCentralDate(now = new Date()) {
  const central = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const [year = "1970", month = "01", day = "01"] = central.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - 1));
  return date.toISOString().slice(0, 10);
}

function centralDateWindow(days: number, now = new Date()) {
  const endDate = previousCentralDate(now);
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate
  };
}
