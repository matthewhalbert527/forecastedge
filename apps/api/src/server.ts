import cors from "@fastify/cors";
import Fastify from "fastify";
import { KALSHI_SETTLEMENT_STATIONS, WEATHER_DATASET_REFERENCES } from "@forecastedge/core";
import { AuditLog } from "./audit/audit-log.js";
import { KalshiDemoBroker } from "./brokers/demo-broker.js";
import { LiveBrokerSafetyShell } from "./brokers/live-broker.js";
import { env, listenPort } from "./config/env.js";
import { MemoryStore } from "./data/store.js";
import { PersistentStore } from "./data/persistent-store.js";
import { ensureDatabaseSchema, getPrisma } from "./db/prisma.js";
import { BackgroundWorker } from "./jobs/background-worker.js";
import { ForecastEdgePipeline } from "./jobs/pipeline.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  const store = new MemoryStore();
  const audit = new AuditLog();
  const prisma = getPrisma();
  const persistentStore = prisma ? new PersistentStore(prisma) : null;
  const pipeline = new ForecastEdgePipeline(store, audit, persistentStore);
  const worker = new BackgroundWorker(pipeline, {
    enabled: env.RUN_BACKGROUND_WORKER,
    runOnStartup: env.RUN_ON_STARTUP,
    intervalMinutes: env.BACKGROUND_POLL_INTERVAL_MINUTES,
    logger: app.log
  });
  const demoBroker = new KalshiDemoBroker();
  const liveBroker = new LiveBrokerSafetyShell();

  app.register(cors, { origin: true });

  app.get("/health", async () => ({
    ok: true,
    mode: env.APP_MODE,
    liveTradingEnabled: env.LIVE_TRADING_ENABLED,
    killSwitchEnabled: env.KILL_SWITCH_ENABLED,
    backgroundWorker: worker.status(),
    demoConfigured: demoBroker.isConfigured(),
    timestamp: new Date().toISOString()
  }));

  app.get("/api/dashboard", async () => {
    const summary = await pipeline.persistedSummary();
    return {
      ...summary,
      auditLogs: "auditLogs" in summary ? summary.auditLogs : audit.list(100),
      safety: {
        liveTradingEnabled: env.LIVE_TRADING_ENABLED,
        killSwitchEnabled: env.KILL_SWITCH_ENABLED,
        requireManualConfirmation: env.REQUIRE_MANUAL_CONFIRMATION,
        demoConfigured: demoBroker.isConfigured(),
        prodCredentialConfigured: Boolean(env.KALSHI_PROD_ACCESS_KEY)
      },
      backgroundWorker: worker.status()
    };
  });

  app.get("/api/settlement-stations", async () => KALSHI_SETTLEMENT_STATIONS);
  app.get("/api/data-sources", async () => WEATHER_DATASET_REFERENCES);

  app.get("/api/audit/scans", async () => store.scanReports.slice(0, 50));
  app.get("/api/audit/latest", async () => ({
    latestScan: store.scanReports[0] ?? null,
    auditLogs: audit.list(250)
  }));

  app.post("/api/run-once", async () => pipeline.runOnce("manual"));
  app.post("/api/settlements/run-once", async () => pipeline.runSettlementsOnly());
  app.post("/api/demo/dry-run-order", async (request) => demoBroker.dryRunOrder(request.body));
  app.post("/api/live/dry-run-order", async (request) => {
    const body = request.body as { order?: unknown; uiConfirmed?: boolean } | undefined;
    const result = liveBroker.evaluateOrderIntent(body?.order ?? {}, Boolean(body?.uiConfirmed));
    if (!result.allowed) audit.record({ actor: "system", type: "live_order_blocked", message: result.reasons.join("; "), metadata: result });
    return result;
  });

  app.addHook("onReady", async () => {
    if (persistentStore) {
      await ensureDatabaseSchema();
      await persistentStore.hydrateMemory(store);
      app.log.info("Hydrated ForecastEdge memory from Postgres");
    }
    worker.start();
  });

  app.addHook("onClose", async () => {
    worker.stop();
    await prisma?.$disconnect();
  });

  return app;
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const app = buildServer();
  await app.listen({ port: listenPort, host: "0.0.0.0" });
}
