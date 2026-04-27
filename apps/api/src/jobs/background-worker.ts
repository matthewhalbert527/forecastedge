import { ForecastEdgePipeline } from "./pipeline.js";

export interface BackgroundWorkerOptions {
  enabled: boolean;
  runOnStartup: boolean;
  intervalMinutes: number;
  logger: {
    info: (payload: unknown, message?: string) => void;
    error: (payload: unknown, message?: string) => void;
  };
}

export class BackgroundWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private runs = 0;

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

    this.options.logger.info({ intervalMinutes: this.options.intervalMinutes }, "ForecastEdge background worker started");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return {
      enabled: this.options.enabled,
      running: this.running,
      intervalMinutes: this.options.intervalMinutes,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      runs: this.runs
    };
  }

  private async run(trigger: "startup" | "scheduled") {
    if (this.running) return;
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
}
