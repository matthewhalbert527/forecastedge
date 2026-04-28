import {
  checkRisk,
  buildEnsembles,
  detectForecastDeltas,
  estimateMarketProbability,
  generateSignal,
  parseKalshiWeatherMarket,
  simulatePaperOrder,
  summarizePaperOrders,
  type KalshiMarketCandidate,
  type MarketMapping,
  type Signal,
  type TrainingCandidate
} from "@forecastedge/core";
import { AuditLog } from "../audit/audit-log.js";
import { activeRiskLimits, env } from "../config/env.js";
import type { PersistentStore } from "../data/persistent-store.js";
import { MemoryStore } from "../data/store.js";
import { discoverWeatherMarkets, getMarketDetails, getOrderBook } from "../kalshi/client.js";
import { reconcilePaperSettlements } from "./settlements.js";
import { fetchAccuWeatherDailyForecast } from "../weather/accuweather.js";
import { fetchNwsLatestStationObservation } from "../weather/nws-station.js";
import { fetchOpenMeteoForecast } from "../weather/open-meteo.js";
import { fetchModelForecasts, unavailableModelPoint } from "../weather/model-stack.js";
import { buildTrainingCandidates } from "./training-candidates.js";

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

      if (env.ENABLE_MODEL_STACK) {
        try {
          const modelForecasts = await fetchModelForecasts(location);
          this.store.modelForecasts.unshift(...modelForecasts);
          report.counts.modelForecasts += modelForecasts.length;
          report.providerResults.push({ provider: "model_stack", locationId: location.id, stationId: location.stationId, status: "ok", message: `Stored ${modelForecasts.length} model forecast points` });
          report.decisions.push({
            stage: "model_forecast",
            itemId: location.id,
            status: "accepted",
            reason: `Stored ECMWF model forecasts for ${location.city}`,
            metadata: { count: modelForecasts.length, models: [...new Set(modelForecasts.map((point) => point.model))] }
          });
          this.audit.record({ actor: "system", type: "model_forecast", message: `Stored ${modelForecasts.length} model forecast points for ${location.city}`, metadata: { count: modelForecasts.length } });
        } catch (error) {
          const unavailable = unavailableModelPoint(location, "ecmwf_ifs", errorMessage(error));
          this.store.modelForecasts.unshift(unavailable);
          report.providerResults.push({ provider: "model_stack", locationId: location.id, stationId: location.stationId, status: "error", message: errorMessage(error) });
          report.decisions.push({ stage: "model_forecast", itemId: location.id, status: "error", reason: errorMessage(error), metadata: unavailable });
          this.audit.record({ actor: "system", type: "error", message: `Model forecast failed for ${location.city}: ${errorMessage(error)}`, metadata: unavailable });
        }
      }
    }

    if (env.ENABLE_MODEL_STACK) {
      this.store.ensembles = buildEnsembles(this.store.modelForecasts.filter((point) => !isUnavailable(point.rawPayload))).slice(0, 500);
      report.counts.ensembles = this.store.ensembles.length;
      for (const ensemble of this.store.ensembles.slice(0, 50)) {
        report.decisions.push({
          stage: "model_ensemble",
          itemId: ensemble.id,
          status: ensemble.confidence === "low" ? "skipped" : "accepted",
          reason: ensemble.reason,
          metadata: ensemble
        });
      }
      this.audit.record({ actor: "system", type: "model_ensemble", message: `Built ${this.store.ensembles.length} ensemble forecasts`, metadata: { count: this.store.ensembles.length } });
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

    this.store.trainingCandidates = buildTrainingCandidates({
      scanId: report.id,
      markets: this.store.markets,
      mappings: this.store.mappings,
      ensembles: this.store.ensembles,
      config: {
        minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100,
        maxSpread: activeRiskLimits.maxSpread,
        minLiquidityScore: activeRiskLimits.minLiquidityScore
      }
    });
    report.counts.trainingCandidates = this.store.trainingCandidates.length;
    for (const candidate of this.store.trainingCandidates.slice(0, 30)) {
      report.decisions.push({
        stage: "training_candidate",
        itemId: candidate.id,
        status: candidate.status === "WOULD_BUY" ? "accepted" : "skipped",
        reason: candidate.reason,
        metadata: { trainingCandidate: candidate }
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
      trainingCandidates: this.store.trainingCandidates.slice(0, 100),
      modelForecasts: this.store.modelForecasts.slice(0, 100),
      ensembles: this.store.ensembles.slice(0, 100),
      performance: summarizePaperOrders(this.store.paperOrders)
    };
  }

  async persistedSummary() {
    return this.persistentStore ? this.persistentStore.dashboardSummary(this.store) : this.summary();
  }

  async refreshQuoteCandidates(trigger: "manual" | "quote_refresh" = "manual") {
    const report = this.store.startScan(trigger);
    const existingCandidates = this.store.trainingCandidates.length > 0
      ? this.store.trainingCandidates
      : buildTrainingCandidates({
        scanId: report.id,
        markets: this.store.markets,
        mappings: this.store.mappings,
        ensembles: this.store.ensembles,
        config: trainingCandidateConfig()
      });
    const candidateTickers = existingCandidates
      .filter((candidate) => candidate.status === "WOULD_BUY" || candidate.status === "WATCH")
      .map((candidate) => candidate.marketTicker);
    const tickers = [...new Set(candidateTickers)].slice(0, 50);

    if (tickers.length === 0) {
      report.providerResults.push({ provider: "kalshi_quotes", locationId: "quotes", status: "skipped", message: "No would-buy or watch candidates to refresh yet" });
      report.counts.trainingCandidates = existingCandidates.length;
      this.finishReport(report);
      await this.persist(report);
      return { refreshedMarkets: 0, wouldBuy: 0, paperOrders: 0, summary: this.summary() };
    }

    const refreshedMarkets: KalshiMarketCandidate[] = [];
    for (const ticker of tickers) {
      try {
        const market = await getMarketDetails(ticker);
        if (!market) {
          report.providerResults.push({ provider: "kalshi_quotes", locationId: ticker, status: "error", message: "Market details unavailable" });
          continue;
        }
        refreshedMarkets.push(market);
        report.providerResults.push({ provider: "kalshi_quotes", locationId: ticker, status: "ok", message: `Refreshed quote for ${ticker}` });
      } catch (error) {
        report.providerResults.push({ provider: "kalshi_quotes", locationId: ticker, status: "error", message: errorMessage(error) });
      }
    }

    this.mergeMarkets(refreshedMarkets);
    const refreshedMappings = refreshedMarkets.map((market) => parseKalshiWeatherMarket(market));
    this.mergeMappings(refreshedMappings);
    report.counts.marketsDiscovered = refreshedMarkets.length;
    report.counts.mappingsAccepted = refreshedMappings.filter((mapping) => mapping.accepted).length;
    report.counts.mappingsRejected = refreshedMappings.filter((mapping) => !mapping.accepted).length;

    this.store.trainingCandidates = buildTrainingCandidates({
      scanId: report.id,
      markets: this.store.markets,
      mappings: this.store.mappings,
      ensembles: this.store.ensembles,
      config: trainingCandidateConfig()
    });
    report.counts.trainingCandidates = this.store.trainingCandidates.length;

    const refreshedTickerSet = new Set(tickers);
    const wouldBuy = this.store.trainingCandidates.filter((candidate) => refreshedTickerSet.has(candidate.marketTicker) && candidate.status === "WOULD_BUY");
    for (const candidate of wouldBuy.slice(0, 30)) {
      report.decisions.push({
        stage: "training_candidate",
        itemId: candidate.id,
        status: "accepted",
        reason: candidate.reason,
        metadata: { trainingCandidate: candidate }
      });
    }

    if (env.APP_MODE === "paper") {
      await this.placePaperOrdersForCandidates(wouldBuy, report);
    }

    this.finishReport(report);
    await this.persist(report);
    return {
      refreshedMarkets: refreshedMarkets.length,
      wouldBuy: wouldBuy.length,
      paperOrders: report.counts.paperOrders,
      summary: this.summary()
    };
  }

  async runSettlementsOnly() {
    if (!this.persistentStore) return { checked: 0, settled: 0, skipped: 0, errors: 1, reason: "DATABASE_URL is not configured" };
    const result = await reconcilePaperSettlements(this.persistentStore, this.audit);
    await this.persistentStore.persistAudit(this.audit.list(250));
    return result;
  }

  private mergeMarkets(markets: KalshiMarketCandidate[]) {
    const byTicker = new Map(this.store.markets.map((market) => [market.ticker, market]));
    for (const market of markets) byTicker.set(market.ticker, market);
    this.store.markets = [...byTicker.values()];
  }

  private mergeMappings(mappings: MarketMapping[]) {
    const byTicker = new Map(this.store.mappings.map((mapping) => [mapping.marketTicker, mapping]));
    for (const mapping of mappings) byTicker.set(mapping.marketTicker, mapping);
    this.store.mappings = [...byTicker.values()];
  }

  private async placePaperOrdersForCandidates(candidates: TrainingCandidate[], report: ReturnType<MemoryStore["startScan"]>) {
    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= env.QUOTE_REFRESH_MAX_PAPER_ORDERS) break;
      if (this.hasPaperExposure(candidate.marketTicker)) continue;
      const mapping = this.store.mappings.find((item) => item.marketTicker === candidate.marketTicker);
      const market = this.store.markets.find((item) => item.ticker === candidate.marketTicker);
      if (!mapping || !market || candidate.entryPrice === null || candidate.edge === null) continue;

      const now = new Date();
      const contracts = Math.max(1, Math.min(activeRiskLimits.maxContractsPerTrade, Math.floor(env.MAX_STAKE_PER_TRADE_PAPER / Math.max(candidate.entryPrice, 0.01))));
      const signal = candidateSignal(candidate, contracts, now);
      const risk = checkRisk(
        { maxCost: signal.maxCost, contracts: signal.contracts },
        this.riskState(),
        activeRiskLimits,
        mapping,
        market,
        now.toISOString(),
        latestForecastObservedAt(this.store.ensembles, mapping) ?? now.toISOString(),
        now
      );

      if (!risk.allowed) {
        const skipped = { ...signal, status: "SKIPPED" as const, skipReason: risk.reasons.join("; "), explanation: `${signal.explanation}. Risk blocked: ${risk.reasons.join("; ")}` };
        this.store.signals.unshift(skipped);
        report.counts.signalsSkipped += 1;
        report.decisions.push({ stage: "signal", itemId: skipped.id, status: "skipped", reason: skipped.skipReason ?? skipped.explanation, metadata: { signal: skipped, risk, trainingCandidate: candidate } });
        continue;
      }

      this.store.signals.unshift(signal);
      report.counts.signalsFired += 1;
      report.decisions.push({ stage: "signal", itemId: signal.id, status: "fired", reason: signal.explanation, metadata: { signal, risk, trainingCandidate: candidate } });

      const orderBook = await getOrderBook(signal.marketTicker);
      const order = simulatePaperOrder(signal, orderBook, undefined, now);
      this.store.paperOrders.unshift(order);
      report.counts.paperOrders += 1;
      placed += 1;
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

  private hasPaperExposure(marketTicker: string) {
    return this.store.paperOrders.some((order) => order.marketTicker === marketTicker && order.filledContracts > 0);
  }

  private riskState() {
    const today = new Date().toISOString().slice(0, 10);
    const filledOrders = this.store.paperOrders.filter((order) => order.filledContracts > 0);
    return {
      realizedPnlToday: 0,
      tradesToday: this.store.paperOrders.filter((order) => order.timestamp.slice(0, 10) === today).length,
      openExposure: filledOrders.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? order.limitPrice) * order.filledContracts, 0),
      openPositions: new Set(filledOrders.map((order) => `${order.marketTicker}:${order.side}`)).size,
      losingStreak: 0,
      exposureByCity: {},
      exposureByWeatherType: {}
    };
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

function trainingCandidateConfig() {
  return {
    minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100,
    maxSpread: activeRiskLimits.maxSpread,
    minLiquidityScore: activeRiskLimits.minLiquidityScore
  };
}

function candidateSignal(candidate: TrainingCandidate, contracts: number, now: Date): Signal {
  const limitPrice = candidate.entryPrice ?? 1;
  return {
    id: `quote_signal_${candidate.marketTicker}_${now.getTime()}`,
    marketTicker: candidate.marketTicker,
    side: "YES",
    action: "BUY",
    contracts,
    limitPrice,
    maxCost: Number((contracts * limitPrice).toFixed(4)),
    edge: candidate.edge ?? 0,
    confidence: "medium",
    explanation: `Quote refresh would buy ${candidate.marketTicker}: ${candidate.reason}`,
    status: "FIRED",
    skipReason: null,
    linkedDeltaId: candidate.id,
    createdAt: now.toISOString()
  };
}

function latestForecastObservedAt(ensembles: Array<{ createdAt: string; targetDate: string; variable: string; stationId: string | null; city: string }>, mapping: MarketMapping) {
  const ensemble = ensembles.find((item) => {
    const sameDate = item.targetDate === mapping.targetDate;
    const sameVariable = item.variable === mapping.variable;
    const sameStation = mapping.station?.stationId && item.stationId === mapping.station.stationId;
    const sameCity = mapping.location?.city && item.city.toLowerCase() === mapping.location.city.toLowerCase();
    return sameDate && sameVariable && Boolean(sameStation || sameCity);
  });
  return ensemble?.createdAt ?? null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function minutesSince(iso: string) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
}

function isUnavailable(rawPayload: unknown) {
  return Boolean(rawPayload && typeof rawPayload === "object" && "unavailable" in rawPayload);
}
