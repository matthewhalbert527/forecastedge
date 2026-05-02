import { ForecastEdgePipeline } from "./pipeline.js";

export interface BackgroundWorkerOptions {
  enabled: boolean;
  runOnStartup: boolean;
  intervalMinutes: number;
  maxRssMb: number;
  quoteRefreshEnabled: boolean;
  quoteRefreshIntervalMinutes: number;
  logger: {
    info: (payload: unknown, message?: string) => void;
    error: (payload: unknown, message?: string) => void;
  };
}

export class BackgroundWorker {
  private timer: NodeJS.Timeout | null = null;
  private quoteTimer: NodeJS.Timeout | null = null;
  private running = false;
  private quoteRefreshRunning = false;
  private lastRunAt: string | null = null;
  private lastQuoteRefreshAt: string | null = null;
  private lastError: string | null = null;
  private lastQuoteRefreshError: string | null = null;
  private runs = 0;
  private quoteRefreshes = 0;

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

    this.options.logger.info({ intervalMinutes: this.options.intervalMinutes }, "ForecastEdge background worker started");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.quoteTimer) clearInterval(this.quoteTimer);
    this.timer = null;
    this.quoteTimer = null;
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
      this.options.logger.info({ lastRunAt: this.lastQuoteRefreshAt, ...result }, "ForecastEdge quote refresh completed");
    } catch (error) {
      this.lastQuoteRefreshError = error instanceof Error ? error.message : "Unknown quote refresh error";
      this.options.logger.error({ err: error }, "ForecastEdge quote refresh failed");
    } finally {
      this.quoteRefreshRunning = false;
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
