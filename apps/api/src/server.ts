import cors from "@fastify/cors";
import Fastify, { type FastifyReply } from "fastify";
import { KALSHI_SETTLEMENT_STATIONS, WEATHER_DATASET_REFERENCES } from "@forecastedge/core";
import { AuditLog } from "./audit/audit-log.js";
import { KalshiDemoBroker } from "./brokers/demo-broker.js";
import { LiveBrokerSafetyShell } from "./brokers/live-broker.js";
import { activeRiskLimits, env, listenPort } from "./config/env.js";
import { MemoryStore } from "./data/store.js";
import { PersistentStore } from "./data/persistent-store.js";
import { ensureDatabaseSchema, getPrisma } from "./db/prisma.js";
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
    quoteRefreshEnabled: env.RUN_QUOTE_REFRESH_WORKER,
    quoteRefreshIntervalMinutes: env.QUOTE_REFRESH_INTERVAL_MINUTES,
    logger: app.log
  });
  const scheduledJobs = createScheduledJobRegistry({ pipeline, persistentStore: () => persistentStore });
  const demoBroker = new KalshiDemoBroker();
  const liveBroker = new LiveBrokerSafetyShell();

  app.register(cors, { origin: true });

  async function dashboardResponse() {
    const summary = await pipeline.persistedSummary();
    return {
      ...summary,
      mode: env.APP_MODE,
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

  app.get("/health", async () => ({
    ok: true,
    mode: env.APP_MODE,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    persistenceEnabled: Boolean(persistentStore),
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
    if (env.SCHEDULED_JOB_TOKEN) {
      const token = request.headers["x-job-token"] ?? bearerToken(request.headers.authorization);
      const queryToken = typeof (request.query as Record<string, unknown> | undefined)?.token === "string" ? (request.query as { token: string }).token : undefined;
      if (token !== env.SCHEDULED_JOB_TOKEN && queryToken !== env.SCHEDULED_JOB_TOKEN) return reply.code(401).send({ error: "Unauthorized research export request" });
    }
    const query = request.query && typeof request.query === "object" ? request.query as Record<string, unknown> : {};
    return pipeline.nightlyResearchExport(integerParam(query.lookbackHours) ?? 24);
  });
  app.get("/api/jobs", async () => scheduledJobs.list());
  app.post("/api/jobs/:jobId/run", async (request, reply) => {
    if (env.SCHEDULED_JOB_TOKEN) {
      const token = request.headers["x-job-token"];
      if (token !== env.SCHEDULED_JOB_TOKEN) return reply.code(401).send({ error: "Unauthorized scheduled job request" });
    }
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
    return dashboardResponse();
  });
  app.post("/api/quotes/refresh-once", async () => {
    const result = await pipeline.refreshQuoteCandidates("quote_refresh");
    return { ...result, summary: await dashboardResponse() };
  });
  app.post("/api/quotes/buy-one", async (request, reply) => {
    const body = request.body as { marketTicker?: unknown } | undefined;
    if (typeof body?.marketTicker !== "string" || body.marketTicker.trim().length === 0) {
      return reply.code(400).send({ error: "marketTicker is required" });
    }
    const result = await pipeline.buyPaperCandidate(body.marketTicker);
    return { ...result, summary: await dashboardResponse() };
  });
  app.post("/api/settlements/run-once", async () => {
    const result = await pipeline.runSettlementsOnly();
    return { ...result, summary: await dashboardResponse() };
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
        await ensureDatabaseSchema();
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
        pipeline.disablePersistence();
        persistentStore = null;
        await prisma?.$disconnect();
      }
    }
    worker.start();
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
