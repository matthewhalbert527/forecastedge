import {
  checkRisk,
  detectForecastDeltas,
  estimateMarketProbability,
  generateSignal,
  parseKalshiWeatherMarket,
  simulatePaperOrder,
  summarizePaperOrders
} from "@forecastedge/core";
import { AuditLog } from "../audit/audit-log.js";
import { activeRiskLimits, env } from "../config/env.js";
import type { PersistentStore } from "../data/persistent-store.js";
import { MemoryStore } from "../data/store.js";
import { discoverWeatherMarkets, getOrderBook } from "../kalshi/client.js";
import { reconcilePaperSettlements } from "./settlements.js";
import { fetchAccuWeatherDailyForecast } from "../weather/accuweather.js";
import { fetchNwsLatestStationObservation } from "../weather/nws-station.js";
import { fetchOpenMeteoForecast } from "../weather/open-meteo.js";

export class ForecastEdgePipeline {
  constructor(
    private readonly store: MemoryStore,
    private readonly audit: AuditLog,
    private readonly persistentStore: PersistentStore | null = null
  ) {}

  async runOnce(trigger: "manual" | "scheduled" | "startup" = "manual") {
    const report = this.store.startScan(trigger);
    for (const location of this.store.locations) {
      let latest = null;
      try {
        const previous = this.store.latestSnapshot(location.id, "open_meteo");
        const cached = previous && minutesSince(previous.createdAt) < env.FORECAST_CACHE_MINUTES;
        if (cached) {
          report.providerResults.push({ provider: "open_meteo", locationId: location.id, status: "skipped", message: `Using cached snapshot ${previous.id}; age ${Math.round(minutesSince(previous.createdAt))} minutes` });
        } else if (!this.store.providerAvailable("open_meteo", location.id)) {
          report.providerResults.push({ provider: "open_meteo", locationId: location.id, status: "skipped", message: "Provider cooldown active after recent rate limit" });
        } else {
          latest = await fetchOpenMeteoForecast(location);
          this.store.forecastSnapshots.unshift(latest);
          report.counts.forecastSnapshots += 1;
          report.providerResults.push({ provider: "open_meteo", locationId: location.id, status: "ok", message: `Stored forecast snapshot ${latest.id}` });
          this.audit.record({ actor: "system", type: "forecast_snapshot", message: `Stored ${latest.provider} snapshot for ${location.city}`, metadata: { snapshotId: latest.id } });

          const deltas = detectForecastDeltas(previous, latest);
          this.store.forecastDeltas.unshift(...deltas);
          report.counts.forecastDeltas += deltas.length;
          for (const delta of deltas) {
            this.audit.record({ actor: "system", type: "forecast_delta", message: delta.reason, metadata: delta });
          }
        }
      } catch (error) {
        const message = errorMessage(error);
        const metadata: Record<string, string> = { locationId: location.id };
        if (message.includes("429")) {
          metadata.cooldownUntil = this.store.coolDownProvider("open_meteo", location.id, env.OPEN_METEO_COOLDOWN_MINUTES);
        }
        report.providerResults.push({ provider: "open_meteo", locationId: location.id, status: "error", message });
        report.decisions.push({ stage: "provider", itemId: `${location.id}:open_meteo`, status: "error", reason: message, metadata });
        this.audit.record({
          actor: "system",
          type: "error",
          message: `Open-Meteo forecast failed for ${location.city}: ${message}`,
          metadata
        });
      }

      try {
        const stationObservation = await fetchNwsLatestStationObservation(location);
        if (stationObservation) {
          this.store.stationObservations.unshift(stationObservation);
          report.counts.stationObservations += 1;
          report.providerResults.push({ provider: "nws_station", locationId: location.id, stationId: location.stationId, status: "ok", message: `Stored ${stationObservation.stationId} observation at ${stationObservation.observedAt}` });
          this.audit.record({
            actor: "system",
            type: "station_observation",
            message: `Stored ${stationObservation.stationId} observation at ${stationObservation.observedAt}`,
            metadata: stationObservation
          });
        }
      } catch (error) {
        report.providerResults.push({ provider: "nws_station", locationId: location.id, stationId: location.stationId, status: "error", message: errorMessage(error) });
        report.decisions.push({ stage: "provider", itemId: `${location.id}:nws_station`, status: "error", reason: errorMessage(error), metadata: { locationId: location.id, stationId: location.stationId } });
        this.audit.record({
          actor: "system",
          type: "error",
          message: `NWS station observation failed for ${location.city}: ${errorMessage(error)}`,
          metadata: { locationId: location.id, stationId: location.stationId }
        });
      }

      try {
        const accuweather = await fetchAccuWeatherDailyForecast(location);
        if (accuweather) {
          this.store.forecastSnapshots.unshift(accuweather);
          report.counts.forecastSnapshots += 1;
          report.providerResults.push({ provider: "accuweather", locationId: location.id, status: "ok", message: `Stored AccuWeather snapshot ${accuweather.id}` });
          this.audit.record({ actor: "system", type: "forecast_snapshot", message: `Stored AccuWeather snapshot for ${location.city}`, metadata: { snapshotId: accuweather.id } });
        } else {
          report.providerResults.push({ provider: "accuweather", locationId: location.id, status: "skipped", message: "AccuWeather API key or location key not configured" });
        }
      } catch (error) {
        report.providerResults.push({ provider: "accuweather", locationId: location.id, status: "error", message: errorMessage(error) });
        report.decisions.push({ stage: "provider", itemId: `${location.id}:accuweather`, status: "error", reason: errorMessage(error), metadata: { locationId: location.id } });
        this.audit.record({
          actor: "system",
          type: "error",
          message: `AccuWeather forecast failed for ${location.city}: ${errorMessage(error)}`,
          metadata: { locationId: location.id }
        });
      }
    }

    this.store.markets = await discoverWeatherMarkets();
    report.counts.marketsDiscovered = this.store.markets.length;
    this.store.mappings = this.store.markets.map((market) => parseKalshiWeatherMarket(market));
    for (const mapping of this.store.mappings) {
      if (mapping.accepted) {
        report.counts.mappingsAccepted += 1;
      } else {
        report.counts.mappingsRejected += 1;
      }
      report.decisions.push({
        stage: "market_mapping",
        itemId: mapping.marketTicker,
        status: mapping.accepted ? "accepted" : "rejected",
        reason: mapping.accepted ? `Mapped to ${mapping.station?.stationId ?? "unknown station"} ${mapping.variable} ${mapping.thresholdOperator} ${mapping.threshold}` : mapping.reviewReason ?? "Mapping rejected",
        metadata: mapping
      });
      this.audit.record({
        actor: "system",
        type: mapping.accepted ? "market_accepted" : "market_rejected",
        message: mapping.accepted ? `Accepted ${mapping.marketTicker}` : `Rejected ${mapping.marketTicker}: ${mapping.reviewReason}`,
        metadata: mapping
      });
    }

    if (env.APP_MODE === "watch") {
      this.finishReport(report);
      await this.persist(report);
      return this.summary();
    }

    for (const delta of this.store.forecastDeltas.slice(0, 20)) {
      const mapping = this.store.mappings.find(
        (candidate) =>
          candidate.accepted &&
          candidate.location?.city === delta.city &&
          candidate.targetDate === delta.targetDate &&
          candidate.variable === delta.variable
      );
      if (!mapping) continue;
      const market = this.store.markets.find((candidate) => candidate.ticker === mapping.marketTicker);
      if (!market) continue;
      const estimate = estimateMarketProbability(mapping, delta, market, { sameDayTempStdDevF: 2, oneDayTempStdDevF: 3, multiDayTempStdDevF: 4.5, minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100 });
      const riskState = {
        realizedPnlToday: 0,
        tradesToday: this.store.paperOrders.filter((order) => order.timestamp.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
        openExposure: this.store.paperOrders.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? 0) * order.filledContracts, 0),
        openPositions: this.store.paperOrders.filter((order) => order.filledContracts > 0).length,
        losingStreak: 0,
        exposureByCity: {},
        exposureByWeatherType: {}
      };
      const now = new Date();
      const risk = checkRisk(
        { maxCost: env.MAX_STAKE_PER_TRADE_PAPER, contracts: Math.max(1, Math.floor(env.MAX_STAKE_PER_TRADE_PAPER / Math.max(market.yesAsk ?? 1, 0.01))) },
        riskState,
        activeRiskLimits,
        mapping,
        market,
        now.toISOString(),
        now.toISOString(),
        now
      );
      const signal = generateSignal(delta, market, mapping, estimate, risk, { minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100, maxStake: env.MAX_STAKE_PER_TRADE_PAPER, maxLongshotPrice: 0.15 }, now);
      this.store.signals.unshift(signal);
      if (signal.status === "FIRED") {
        report.counts.signalsFired += 1;
      } else {
        report.counts.signalsSkipped += 1;
      }
      report.decisions.push({
        stage: "signal",
        itemId: signal.id,
        status: signal.status === "FIRED" ? "fired" : "skipped",
        reason: signal.skipReason ?? signal.explanation,
        metadata: { signal, probability: estimate, risk }
      });
      this.audit.record({ actor: "system", type: signal.status === "FIRED" ? "signal_fired" : "signal_skipped", message: signal.explanation, metadata: signal });

      if (env.APP_MODE === "paper" && signal.status === "FIRED") {
        const orderBook = await getOrderBook(signal.marketTicker);
        const order = simulatePaperOrder(signal, orderBook, undefined, now);
        this.store.paperOrders.unshift(order);
        report.counts.paperOrders += 1;
        report.decisions.push({
          stage: "paper_order",
          itemId: order.id,
          status: order.status === "FILLED" ? "filled" : order.status === "PARTIAL" ? "partial" : "rejected",
          reason: order.reason,
          metadata: order
        });
        this.audit.record({ actor: "system", type: "paper_order", message: `${order.status}: ${order.reason}`, metadata: order });
      }
    }

    await this.persist(report);
    if (env.APP_MODE === "paper" && this.persistentStore) {
      const settlementResult = await reconcilePaperSettlements(this.persistentStore, this.audit, report);
      report.decisions.push({
        stage: "settlement",
        itemId: "paper_settlement_run",
        status: settlementResult.errors > 0 ? "error" : "accepted",
        reason: `Settlement reconciliation checked ${settlementResult.checked}, settled ${settlementResult.settled}, skipped ${settlementResult.skipped}, errors ${settlementResult.errors}`,
        metadata: settlementResult
      });
    }
    this.finishReport(report);
    await this.persist(report);
    return this.summary();
  }

  summary() {
    return {
      mode: env.APP_MODE,
      locations: this.store.locations,
      scanReports: this.store.scanReports.slice(0, 20),
      forecastSnapshots: this.store.forecastSnapshots.slice(0, 10),
      stationObservations: this.store.stationObservations.slice(0, 20),
      forecastDeltas: this.store.forecastDeltas.slice(0, 50),
      markets: this.store.markets.slice(0, 100),
      mappings: this.store.mappings.slice(0, 100),
      signals: this.store.signals.slice(0, 100),
      paperOrders: this.store.paperOrders.slice(0, 100),
      paperPositions: [],
      settlements: [],
      performance: summarizePaperOrders(this.store.paperOrders)
    };
  }

  async persistedSummary() {
    return this.persistentStore ? this.persistentStore.dashboardSummary(this.store) : this.summary();
  }

  async runSettlementsOnly() {
    if (!this.persistentStore) return { checked: 0, settled: 0, skipped: 0, errors: 1, reason: "DATABASE_URL is not configured" };
    const result = await reconcilePaperSettlements(this.persistentStore, this.audit);
    await this.persistentStore.persistAudit(this.audit.list(250));
    return result;
  }

  private finishReport(report: ReturnType<MemoryStore["startScan"]>) {
    report.completedAt = new Date().toISOString();
    report.status = report.decisions.some((decision) => decision.status === "error") ? "completed_with_errors" : "completed";
    this.audit.record({
      actor: "system",
      type: "scan_completed",
      message: `Scan ${report.id} completed: ${report.counts.marketsDiscovered} markets, ${report.counts.mappingsAccepted} accepted mappings, ${report.counts.signalsFired} fired signals`,
      metadata: report
    });
  }

  private async persist(report: ReturnType<MemoryStore["startScan"]>) {
    if (!this.persistentStore) return;
    try {
      await this.persistentStore.persistScanState(this.store, report, this.audit.list(500));
    } catch (error) {
      this.audit.record({
        actor: "system",
        type: "error",
        message: `Postgres persistence failed: ${errorMessage(error)}`,
        metadata: { reportId: report.id }
      });
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function minutesSince(iso: string) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
}
