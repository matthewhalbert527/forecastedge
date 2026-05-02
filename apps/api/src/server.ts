import cors from "@fastify/cors";
import Fastify, { type FastifyReply } from "fastify";
import { KALSHI_SETTLEMENT_STATIONS, WEATHER_DATASET_REFERENCES } from "@forecastedge/core";
import { AuditLog } from "./audit/audit-log.js";
import { KalshiDemoBroker } from "./brokers/demo-broker.js";
import { LiveBrokerSafetyShell } from "./brokers/live-broker.js";
import { activeRiskLimits, env, listenPort } from "./config/env.js";
import { MemoryStore } from "./data/store.js";
import { PersistentStore } from "./data/persistent-store.js";
import { getPrisma } from "./db/prisma.js";
import { BackgroundWorker } from "./jobs/background-worker.js";
import { ForecastEdgePipeline } from "./jobs/pipeline.js";
import { createScheduledJobRegistry } from "./jobs/scheduled-jobs.js";
import {
  getHistoricalMarketCandlesticks,
  getHistoricalMarkets,
  getHistoricalTrades,
  getLiveMarketCandlesticks,
  getLiveTrades,
  getMarketDetails,
  isPlausibleWeatherMarket
} from "./kalshi/client.js";

export function buildServer() {
  const app = Fastify({ logger: true, pluginTimeout: 120_000 });
  const store = new MemoryStore();
  const audit = new AuditLog();
  const prisma = getPrisma();
  let persistentStore = prisma ? new PersistentStore(prisma) : null;
  const pipeline = new ForecastEdgePipeline(store, audit, persistentStore);
  const worker = new BackgroundWorker(pipeline, {
    enabled: env.RUN_BACKGROUND_WORKER,
    runOnStartup: env.RUN_ON_STARTUP,
    intervalMinutes: env.BACKGROUND_POLL_INTERVAL_MINUTES,
    maxRssMb: env.BACKGROUND_WORKER_MAX_RSS_MB,
    quoteRefreshEnabled: env.RUN_QUOTE_REFRESH_WORKER,
    quoteRefreshIntervalMinutes: env.QUOTE_REFRESH_INTERVAL_MINUTES,
    learningCycleEnabled: env.RUN_LEARNING_CYCLE_WORKER,
    learningCycleIntervalMinutes: env.LEARNING_CYCLE_INTERVAL_MINUTES,
    learningCycleMinSettledExamples: env.LEARNING_CYCLE_MIN_SETTLED_EXAMPLES,
    learningCycleBacktestLookbackDays: env.LEARNING_CYCLE_BACKTEST_LOOKBACK_DAYS,
    logger: app.log
  });
  const scheduledJobs = createScheduledJobRegistry({ pipeline, persistentStore: () => persistentStore });
  const demoBroker = new KalshiDemoBroker();
  const liveBroker = new LiveBrokerSafetyShell();

  app.register(cors, { origin: async (origin: string | undefined) => corsOriginAllowed(origin) });

  app.addHook("preHandler", async (request, reply) => {
    if (!requiresPrivilegedAuth(request.method, request.url)) return;
    const allowedTokens = privilegedTokens();
    if (allowedTokens.length === 0) {
      if (env.NODE_ENV === "production") {
        return reply.code(503).send({ error: "Privileged ForecastEdge API routes require FORECASTEDGE_API_TOKEN or SCHEDULED_JOB_TOKEN" });
      }
      return;
    }
    if (!allowedTokens.includes(requestToken(request.headers))) {
      return reply.code(401).send({ error: "Unauthorized ForecastEdge API request" });
    }
  });

  type DashboardSummary = Awaited<ReturnType<ForecastEdgePipeline["persistedSummary"]>>;
  function decorateDashboardSummary(summary: DashboardSummary) {
    return {
      ...summary,
      mode: env.APP_MODE,
      paperLearningMode: env.APP_MODE === "paper" && env.PAPER_LEARNING_MODE,
      auditLogs: "auditLogs" in summary ? summary.auditLogs : audit.list(100),
      safety: {
        liveTradingEnabled: env.LIVE_TRADING_ENABLED,
        killSwitchEnabled: env.KILL_SWITCH_ENABLED,
        requireManualConfirmation: env.REQUIRE_MANUAL_CONFIRMATION,
        demoConfigured: demoBroker.isConfigured(),
        prodCredentialConfigured: Boolean(env.KALSHI_PROD_ACCESS_KEY)
      },
      riskLimits: activeRiskLimits,
      backgroundWorker: worker.status(),
      scheduledJobs: scheduledJobs.list()
    };
  }

  async function buildDashboardResponse() {
    try {
      return decorateDashboardSummary(await pipeline.persistedSummary());
    } catch (error) {
      app.log.error({ err: error }, "Persisted dashboard summary failed; returning in-memory fallback");
      return buildFallbackDashboardResponse();
    }
  }

  function buildFallbackDashboardResponse() {
    return decorateDashboardSummary(pipeline.summary());
  }

  type DashboardResponse = Awaited<ReturnType<typeof buildDashboardResponse>>;
  const dashboardCacheTtlMs = 60_000;
  const dashboardBuildTimeoutMs = 4_000;
  let dashboardCache: { expiresAt: number; value: DashboardResponse } | null = null;
  let dashboardInFlight: Promise<DashboardResponse> | null = null;

  async function dashboardResponse(options: { force?: boolean } = {}) {
    const now = Date.now();
    if (!options.force && dashboardCache && dashboardCache.expiresAt > now) return dashboardCache.value;
    if (dashboardInFlight) {
      if (!options.force && dashboardCache) return dashboardCache.value;
      return withTimeout(dashboardInFlight, buildFallbackDashboardResponse(), dashboardBuildTimeoutMs);
    }

    dashboardInFlight = buildDashboardResponse()
      .then((value) => {
        dashboardCache = { value, expiresAt: Date.now() + dashboardCacheTtlMs };
        return value;
      })
      .finally(() => {
        dashboardInFlight = null;
      });
    if (!options.force && dashboardCache) return dashboardCache.value;
    return options.force ? dashboardInFlight : withTimeout(dashboardInFlight, buildFallbackDashboardResponse(), dashboardBuildTimeoutMs);
  }

  app.get("/health", async () => ({
    ok: true,
    mode: env.APP_MODE,
    paperLearningMode: env.APP_MODE === "paper" && env.PAPER_LEARNING_MODE,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    persistenceEnabled: Boolean(persistentStore),
    persistenceReason: pipeline.persistenceStatus().reason,
    dailyEmailConfigured: Boolean(env.RESEND_API_KEY && env.DAILY_REPORT_EMAIL_TO && env.DAILY_REPORT_EMAIL_FROM),
    liveTradingEnabled: env.LIVE_TRADING_ENABLED,
    killSwitchEnabled: env.KILL_SWITCH_ENABLED,
    backgroundWorker: worker.status(),
    demoConfigured: demoBroker.isConfigured(),
    timestamp: new Date().toISOString()
  }));

  app.get("/api/dashboard", async () => dashboardResponse());
  app.get("/api/learning/summary", async () => pipeline.learningSummary());
  app.get("/api/strategy/decision-dashboard", async () => pipeline.strategyDecisionDashboard());
  app.get("/api/research/nightly-export", async (request, reply) => {
    const query = request.query && typeof request.query === "object" ? request.query as Record<string, unknown> : {};
    return pipeline.nightlyResearchExport(integerParam(query.lookbackHours) ?? 24);
  });
  app.get("/api/jobs", async () => scheduledJobs.list());
  app.post("/api/jobs/:jobId/run", async (request, reply) => {
    const params = request.params as { jobId?: string };
    const result = await scheduledJobs.run(params.jobId ?? "");
    if (!result) return reply.code(404).send({ error: "Unknown scheduled job" });
    return result;
  });
  function datasetDownload(reply: FastifyReply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return reply
      .header("Content-Type", "application/x-ndjson; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="forecastedge-dataset-${stamp}.ndjson"`)
      .send(pipeline.exportLearningDatasetStream());
  }
  app.get("/api/dataset/export", async (_request, reply) => datasetDownload(reply));
  app.get("/api/learning/export", async (_request, reply) => datasetDownload(reply));
  app.post("/api/backtests/run", async (request) => {
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    return pipeline.runStoredBacktest(body);
  });
  app.post("/api/historical/sync", async (request, reply) => {
    if (!persistentStore) return reply.code(400).send({ error: "DATABASE_URL is required to persist historical Kalshi data" });
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const tickers = stringList(body.tickers);
    const seriesTicker = typeof body.seriesTicker === "string" ? body.seriesTicker : undefined;
    const periodInterval = periodParam(body.periodInterval);
    const endTs = integerParam(body.endTs) ?? Math.floor(Date.now() / 1000);
    const startTs = integerParam(body.startTs) ?? endTs - 90 * 24 * 60 * 60;
    const maxPages = integerParam(body.maxPages) ?? 3;
    const includeTrades = body.includeTrades !== false;
    const includeCandlesticks = body.includeCandlesticks !== false;
    const source = body.source === "live" ? "live" : "historical";
    if (endTs <= startTs) return reply.code(400).send({ error: "endTs must be after startTs" });
    if (endTs - startTs > 366 * 24 * 60 * 60) return reply.code(400).send({ error: "historical sync is capped at 366 days per request" });
    if (tickers.length > 25) return reply.code(400).send({ error: "historical sync is capped at 25 explicit tickers per request" });
    if (!seriesTicker && tickers.length === 0) return reply.code(400).send({ error: "seriesTicker or tickers is required" });

    const marketRequest: { tickers?: string[]; seriesTicker?: string; maxPages: number } = { maxPages };
    if (tickers.length > 0) marketRequest.tickers = tickers;
    if (seriesTicker) marketRequest.seriesTicker = seriesTicker;
    const markets = source === "historical" ? await getHistoricalMarkets(marketRequest) : [];
    const liveMarkets = source === "live" && tickers.length > 0 ? (await Promise.all(tickers.map((ticker) => getMarketDetails(ticker)))).filter((market) => market !== null) : [];
    const weatherMarkets = markets.filter((market) => tickers.length > 0 || isPlausibleWeatherMarket(market));
    await persistentStore.persistHistoricalMarkets(weatherMarkets);
    await persistentStore.persistMarkets(liveMarkets);
    const targetTickers = tickers.length > 0 ? tickers : weatherMarkets.map((market) => market.ticker);
    let candlesticks = 0;
    let trades = 0;

    for (const ticker of targetTickers) {
      const market = weatherMarkets.find((item) => item.ticker === ticker);
      if (includeCandlesticks) {
        const liveSeriesTicker = seriesTicker ?? seriesFromMarket(ticker, market?.eventTicker);
        const rows = source === "live" && liveSeriesTicker
          ? await getLiveMarketCandlesticks(liveSeriesTicker, ticker, { startTs, endTs, periodInterval, includeLatestBeforeStart: true })
          : await getHistoricalMarketCandlesticks(ticker, { startTs, endTs, periodInterval });
        await persistentStore.persistMarketCandlesticks(rows, source, periodInterval);
        candlesticks += rows.length;
      }
      if (includeTrades) {
        const rows = source === "live"
          ? await getLiveTrades({ ticker, minTs: startTs, maxTs: endTs, maxPages })
          : await getHistoricalTrades({ ticker, minTs: startTs, maxTs: endTs, maxPages });
        await persistentStore.persistMarketTrades(rows, source);
        trades += rows.length;
      }
    }

    return {
      source,
      markets: weatherMarkets.length,
      tickers: targetTickers.length,
      candlesticks,
      trades,
      periodInterval,
      startTs,
      endTs
    };
  });

  app.get("/api/settlement-stations", async () => KALSHI_SETTLEMENT_STATIONS);
  app.get("/api/data-sources", async () => WEATHER_DATASET_REFERENCES);

  app.get("/api/audit/scans", async () => store.scanReports.slice(0, 50));
  app.get("/api/audit/latest", async () => ({
    latestScan: store.scanReports[0] ?? null,
    auditLogs: audit.list(250)
  }));

  app.post("/api/run-once", async () => {
    await pipeline.runOnce("manual");
    return dashboardResponse({ force: true });
  });
  app.post("/api/quotes/refresh-once", async () => {
    const result = await pipeline.refreshQuoteCandidates("quote_refresh");
    return { ...result, summary: await dashboardResponse({ force: true }) };
  });
  app.post("/api/quotes/buy-one", async (request, reply) => {
    const body = request.body as { marketTicker?: unknown } | undefined;
    if (typeof body?.marketTicker !== "string" || body.marketTicker.trim().length === 0) {
      return reply.code(400).send({ error: "marketTicker is required" });
    }
    const result = await pipeline.buyPaperCandidate(body.marketTicker);
    return { ...result, summary: await dashboardResponse({ force: true }) };
  });
  app.post("/api/settlements/run-once", async () => {
    const result = await pipeline.runSettlementsOnly();
    return { ...result, summary: await dashboardResponse({ force: true }) };
  });
  app.post("/api/demo/dry-run-order", async (request) => demoBroker.dryRunOrder(request.body));
  app.post("/api/live/dry-run-order", async (request) => {
    const body = request.body as { order?: unknown; uiConfirmed?: boolean } | undefined;
    const result = liveBroker.evaluateOrderIntent(body?.order ?? {}, Boolean(body?.uiConfirmed));
    if (!result.allowed) audit.record({ actor: "system", type: "live_order_blocked", message: result.reasons.join("; "), metadata: result });
    return result;
  });

  app.addHook("onReady", async () => {
    if (persistentStore) {
      try {
        await persistentStore.hydrateMemory(store);
        app.log.info("Hydrated ForecastEdge memory from Postgres");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown database startup error";
        app.log.error({ err: error }, `Postgres unavailable; continuing with in-memory store: ${message}`);
        audit.record({
          actor: "system",
          type: "error",
          message: `Postgres unavailable; continuing with in-memory store: ${message}`,
          metadata: {}
        });
        pipeline.disablePersistence(`Postgres unavailable at startup: ${message}`);
        persistentStore = null;
        await prisma?.$disconnect();
      }
    }
    worker.start();
    void dashboardResponse({ force: true })
      .then(() => app.log.info("Prewarmed ForecastEdge dashboard cache"))
      .catch((error) => app.log.error({ err: error }, "ForecastEdge dashboard cache prewarm failed"));
  });

  app.addHook("onClose", async () => {
    worker.stop();
    await prisma?.$disconnect();
  });

  return app;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (typeof value === "string" && value.trim().length > 0) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function integerParam(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

function bearerToken(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function corsOriginAllowed(origin: string | undefined) {
  if (!origin) return true;
  const allowed = env.CORS_ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean);
  if (env.NODE_ENV !== "production" && allowed.length === 0) return true;
  return allowed.includes(origin);
}

function requiresPrivilegedAuth(method: string, url: string) {
  const path = url.split("?")[0] ?? url;
  if (method === "OPTIONS" || !path.startsWith("/api/")) return false;
  return !isPublicApiRoute(method, path);
}

function isPublicApiRoute(method: string, path: string) {
  return method === "GET" && (path === "/api/settlement-stations" || path === "/api/data-sources");
}

function privilegedTokens() {
  return [env.FORECASTEDGE_API_TOKEN, env.SCHEDULED_JOB_TOKEN].filter((token): token is string => Boolean(token));
}

function requestToken(headers: Record<string, unknown>) {
  const direct = headers["x-forecastedge-token"] ?? headers["x-job-token"];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return direct[0] ?? "";
  return bearerToken(headers.authorization) ?? "";
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function periodParam(value: unknown): 1 | 60 | 1440 {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return parsed === 1 || parsed === 60 || parsed === 1440 ? parsed : 60;
}

function seriesFromMarket(ticker: string, eventTicker?: string) {
  const source = eventTicker ?? ticker;
  const [series] = source.split("-");
  return series && series.length > 0 ? series : null;
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const app = buildServer();
  await app.listen({ port: listenPort, host: "0.0.0.0" });
}
