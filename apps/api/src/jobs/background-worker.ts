import { ForecastEdgePipeline } from "./pipeline.js";

export interface BackgroundWorkerOptions {
  enabled: boolean;
  runOnStartup: boolean;
  intervalMinutes: number;
  maxRssMb: number;
  quoteRefreshEnabled: boolean;
  quoteRefreshIntervalMinutes: number;
  learningCycleEnabled: boolean;
  learningCycleIntervalMinutes: number;
  learningCycleMinSettledExamples: number;
  learningCycleBacktestLookbackDays: number;
  logger: {
    info: (payload: unknown, message?: string) => void;
    error: (payload: unknown, message?: string) => void;
  };
}

export class BackgroundWorker {
  private timer: NodeJS.Timeout | null = null;
  private quoteTimer: NodeJS.Timeout | null = null;
  private learningTimer: NodeJS.Timeout | null = null;
  private running = false;
  private quoteRefreshRunning = false;
  private learningCycleRunning = false;
  private lastRunAt: string | null = null;
  private lastQuoteRefreshAt: string | null = null;
  private lastLearningCycleAt: string | null = null;
  private lastError: string | null = null;
  private lastQuoteRefreshError: string | null = null;
  private lastLearningCycleError: string | null = null;
  private runs = 0;
  private quoteRefreshes = 0;
  private learningCycles = 0;

  constructor(
    private readonly pipeline: ForecastEdgePipeline,
    private readonly options: BackgroundWorkerOptions
  ) {}

  start() {
    if (!this.options.enabled || this.timer) return;

    const intervalMs = Math.max(1, this.options.intervalMinutes) * 60_000;
    this.timer = setInterval(() => {
      void this.run("scheduled");
    }, intervalMs);

    if (this.options.runOnStartup) {
      void this.run("startup");
    }

    if (this.options.quoteRefreshEnabled && !this.quoteTimer) {
      const quoteIntervalMs = Math.max(1, this.options.quoteRefreshIntervalMinutes) * 60_000;
      this.quoteTimer = setInterval(() => {
        void this.runQuoteRefresh();
      }, quoteIntervalMs);
      this.options.logger.info({ intervalMinutes: this.options.quoteRefreshIntervalMinutes }, "ForecastEdge quote refresh worker started");
    }

    if (this.options.learningCycleEnabled && !this.learningTimer) {
      const learningIntervalMs = Math.max(60, this.options.learningCycleIntervalMinutes) * 60_000;
      this.learningTimer = setInterval(() => {
        void this.runLearningCycle();
      }, learningIntervalMs);
      this.options.logger.info(
        {
          intervalMinutes: this.options.learningCycleIntervalMinutes,
          minSettledExamples: this.options.learningCycleMinSettledExamples,
          backtestLookbackDays: this.options.learningCycleBacktestLookbackDays
        },
        "ForecastEdge learning cycle worker started"
      );
    }

    this.options.logger.info({ intervalMinutes: this.options.intervalMinutes }, "ForecastEdge background worker started");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.quoteTimer) clearInterval(this.quoteTimer);
    if (this.learningTimer) clearInterval(this.learningTimer);
    this.timer = null;
    this.quoteTimer = null;
    this.learningTimer = null;
  }

  status() {
    return {
      enabled: this.options.enabled,
      running: this.running,
      intervalMinutes: this.options.intervalMinutes,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      runs: this.runs,
      quoteRefresh: {
        enabled: this.options.enabled && this.options.quoteRefreshEnabled,
        running: this.quoteRefreshRunning,
        intervalMinutes: this.options.quoteRefreshIntervalMinutes,
        lastRunAt: this.lastQuoteRefreshAt,
        lastError: this.lastQuoteRefreshError,
        runs: this.quoteRefreshes
      },
      learningCycle: {
        enabled: this.options.enabled && this.options.learningCycleEnabled,
        running: this.learningCycleRunning,
        intervalMinutes: this.options.learningCycleIntervalMinutes,
        minSettledExamples: this.options.learningCycleMinSettledExamples,
        backtestLookbackDays: this.options.learningCycleBacktestLookbackDays,
        lastRunAt: this.lastLearningCycleAt,
        lastError: this.lastLearningCycleError,
        runs: this.learningCycles
      },
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        maxRssMb: this.options.maxRssMb || null
      }
    };
  }

  private async run(trigger: "startup" | "scheduled") {
    if (this.running) return;
    const memorySkip = this.memorySkipReason("scan");
    if (memorySkip) {
      this.lastError = memorySkip;
      this.options.logger.info({ trigger, memory: this.memoryStatus() }, memorySkip);
      return;
    }
    this.running = true;
    try {
      await this.pipeline.runOnce(trigger);
      this.lastRunAt = new Date().toISOString();
      this.lastError = null;
      this.runs += 1;
      this.options.logger.info({ trigger, lastRunAt: this.lastRunAt }, "ForecastEdge scan completed");
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown background worker error";
      this.options.logger.error({ trigger, err: error }, "ForecastEdge scan failed");
    } finally {
      this.running = false;
    }
  }

  private async runQuoteRefresh() {
    if (this.running || this.quoteRefreshRunning) return;
    const memorySkip = this.memorySkipReason("quote refresh");
    if (memorySkip) {
      this.lastQuoteRefreshError = memorySkip;
      this.options.logger.info({ memory: this.memoryStatus() }, memorySkip);
      return;
    }
    this.quoteRefreshRunning = true;
    try {
      const result = await this.pipeline.refreshQuoteCandidates("quote_refresh");
      this.lastQuoteRefreshAt = new Date().toISOString();
      this.lastQuoteRefreshError = null;
      this.quoteRefreshes += 1;
      this.options.logger.info({ lastRunAt: this.lastQuoteRefreshAt, ...compactQuoteRefreshResult(result) }, "ForecastEdge quote refresh completed");
    } catch (error) {
      this.lastQuoteRefreshError = error instanceof Error ? error.message : "Unknown quote refresh error";
      this.options.logger.error({ err: error }, "ForecastEdge quote refresh failed");
    } finally {
      this.quoteRefreshRunning = false;
    }
  }

  private async runLearningCycle() {
    if (this.running || this.quoteRefreshRunning || this.learningCycleRunning) return;
    const memorySkip = this.memorySkipReason("learning cycle");
    if (memorySkip) {
      this.lastLearningCycleError = memorySkip;
      this.options.logger.info({ memory: this.memoryStatus() }, memorySkip);
      return;
    }
    this.learningCycleRunning = true;
    try {
      const settlement = await this.pipeline.runSettlementsOnly();
      const learning = await this.pipeline.learningSummary();
      const settledExamples = learning.collection.settledPaperTradeExamples;
      const window = learningCycleWindow(this.options.learningCycleBacktestLookbackDays);
      let alphaReport: ReturnType<typeof compactOptimizationReport> | null = null;
      let optimizer: ReturnType<typeof compactOptimizationReport> | null = null;
      let skippedOptimizationReason: string | null = null;

      if (settledExamples >= this.options.learningCycleMinSettledExamples) {
        alphaReport = compactOptimizationReport(await this.pipeline.runDailyAlphaReport({
          trigger: "continuous_learning_cycle",
          validationMode: "walk_forward",
          slippageCents: 2,
          startDate: window.startDate,
          endDate: window.endDate
        }));
        optimizer = compactOptimizationReport(await this.pipeline.runStrategyOptimizer({
          trigger: "continuous_learning_cycle",
          validationMode: "walk_forward",
          startDate: window.startDate,
          endDate: window.endDate
        }));
      } else {
        skippedOptimizationReason = `Only ${settledExamples} settled paper examples; waiting for ${this.options.learningCycleMinSettledExamples}`;
      }

      const strategyHealth = await this.pipeline.strategyDecisionDashboard();
      this.lastLearningCycleAt = new Date().toISOString();
      this.lastLearningCycleError = null;
      this.learningCycles += 1;
      this.options.logger.info(
        {
          lastRunAt: this.lastLearningCycleAt,
          window,
          settlement,
          settledExamples,
          alphaReport,
          optimizer,
          skippedOptimizationReason,
          strategyHealth: {
            statuses: strategyHealth.statuses,
            warnings: strategyHealth.warningsRequiringReview.length
          }
        },
        "ForecastEdge learning cycle completed"
      );
    } catch (error) {
      this.lastLearningCycleError = error instanceof Error ? error.message : "Unknown learning cycle error";
      this.options.logger.error({ err: error }, "ForecastEdge learning cycle failed");
    } finally {
      this.learningCycleRunning = false;
    }
  }

  private memorySkipReason(operation: string) {
    const maxRssMb = this.options.maxRssMb;
    if (maxRssMb <= 0) return null;
    const rssMb = this.memoryStatus().rssMb;
    if (rssMb < maxRssMb) return null;
    return `Skipping ForecastEdge ${operation}; RSS ${rssMb} MB is at or above BACKGROUND_WORKER_MAX_RSS_MB=${maxRssMb}`;
  }

  private memoryStatus() {
    return {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      maxRssMb: this.options.maxRssMb || null
    };
  }
}

function compactQuoteRefreshResult(result: Awaited<ReturnType<ForecastEdgePipeline["refreshQuoteCandidates"]>>) {
  return {
    trigger: result.trigger,
    candidateSource: result.candidateSource,
    tickersConsidered: result.tickersConsidered,
    tickersRefreshed: result.tickersRefreshed,
    wouldBuy: result.wouldBuy,
    watch: result.watch,
    paperOrders: result.paperOrders,
    errors: result.errors
  };
}

function compactOptimizationReport(report: {
  id: string;
  status: string;
  recommendation: string;
  bestCandidate: unknown;
  challengers: unknown[];
}) {
  return {
    id: report.id,
    status: report.status,
    recommendation: report.recommendation,
    bestCandidate: compactCandidate(report.bestCandidate),
    challengers: report.challengers.length
  };
}

function compactCandidate(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  return {
    strategyKey: stringOrNull(record.strategyKey),
    approvalStatus: stringOrNull(record.approvalStatus),
    evaluatedMarkets: numberOrNull(record.evaluatedMarkets),
    totalPnl: numberOrNull(record.totalPnl),
    roi: numberOrNull(record.roi),
    score: numberOrNull(record.score)
  };
}

function learningCycleWindow(lookbackDays: number, now = new Date()) {
  return {
    startDate: centralDateDaysAgo(lookbackDays, now),
    endDate: centralDateDaysAgo(0, now)
  };
}

function centralDateDaysAgo(daysAgo: number, now = new Date()) {
  const central = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const [year = "1970", month = "01", day = "01"] = central.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - Math.max(0, Math.floor(daysAgo))));
  return date.toISOString().slice(0, 10);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
