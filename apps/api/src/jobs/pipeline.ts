import {
  checkRisk,
  buildEnsembles,
  computeTradeQuality,
  detectForecastDeltas,
  estimateMarketProbability,
  generateSignal,
  parseKalshiWeatherMarket,
  buildPaperPositionsFromOrders,
  simulatePaperOrder,
  summarizePaperPerformanceWindows,
  summarizePaperOrders,
  type KalshiMarketCandidate,
  type MarketMapping,
  type Signal,
  type TrainingCandidate
} from "@forecastedge/core";
import { Readable } from "node:stream";
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
import { buildTrainingCandidates, type TrainingCandidateConfig } from "./training-candidates.js";

export class ForecastEdgePipeline {
  private persistenceDisabledReason: string | null = null;

  constructor(
    private readonly store: MemoryStore,
    private readonly audit: AuditLog,
    private persistentStore: PersistentStore | null = null
  ) {}

  disablePersistence(reason?: string) {
    this.persistentStore = null;
    this.persistenceDisabledReason = reason ?? this.persistenceDisabledReason ?? "Persistence was disabled";
  }

  persistenceStatus() {
    return {
      enabled: Boolean(this.persistentStore),
      reason: this.persistenceDisabledReason
    };
  }

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

    const candidateConfig = await this.trainingCandidateConfig();
    this.store.trainingCandidates = buildTrainingCandidates({
      scanId: report.id,
      markets: this.store.markets,
      mappings: this.store.mappings,
      ensembles: this.store.ensembles,
      config: candidateConfig
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

    if (env.APP_MODE === "paper") {
      await this.placePaperOrdersForCandidates(
        this.store.trainingCandidates.filter((candidate) => candidate.status === "WOULD_BUY"),
        report
      );
    }

    if (env.APP_MODE === "watch") {
      this.finishReport(report);
      await this.persist(report);
      return this.summary();
    }

    if (env.APP_MODE === "paper") {
      await this.persist(report);
      if (this.persistentStore) {
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
      const now = new Date();
      const entryPrice = market.yesAsk ?? (market.noBid !== null ? 1 - market.noBid : null);
      const spread = market.yesAsk !== null && market.yesBid !== null ? market.yesAsk - market.yesBid : null;
      const quality = computeTradeQuality({
        probability: estimate,
        entryPrice,
        spread,
        liquidityScore: mapping.liquidityScore,
        config: {
          minNetEdge: 0.03,
          minQualityScore: activeRiskLimits.minQualityScore,
          maxStake: env.MAX_STAKE_PER_TRADE_PAPER,
          maxContracts: activeRiskLimits.maxContractsPerTrade
        }
      });
      const risk = checkRisk(
        {
          maxCost: quality.recommendedStake ?? 0,
          contracts: quality.recommendedContracts ?? 0,
          qualityScore: quality.qualityScore,
          netEdge: quality.netEdge,
          uncertaintyPenalty: quality.uncertaintyPenalty,
          fillPenalty: quality.fillPenalty,
          diversificationPenalty: quality.diversificationPenalty
        },
        this.riskState(),
        activeRiskLimits,
        mapping,
        market,
        now.toISOString(),
        now.toISOString(),
        now
      );
      const signal = generateSignal(delta, market, mapping, estimate, risk, {
        minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100,
        minNetEdge: 0.03,
        minQualityScore: activeRiskLimits.minQualityScore,
        maxStake: env.MAX_STAKE_PER_TRADE_PAPER,
        maxContracts: activeRiskLimits.maxContractsPerTrade,
        maxLongshotPrice: 0.15
      }, now);
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

    }

    await this.persist(report);
    this.finishReport(report);
    await this.persist(report);
    return this.summary();
  }

  summary() {
    const paperPositions = buildPaperPositionsFromOrders(this.store.paperOrders);
    return {
      mode: env.APP_MODE,
      paperLearningMode: env.APP_MODE === "paper" && env.PAPER_LEARNING_MODE,
      locations: this.store.locations,
      scanReports: this.store.scanReports.slice(0, 20),
      forecastSnapshots: this.store.forecastSnapshots.slice(0, 10),
      stationObservations: this.store.stationObservations.slice(0, 20),
      forecastDeltas: this.store.forecastDeltas.slice(0, 50),
      markets: this.store.markets.slice(0, 250),
      mappings: this.store.mappings.slice(0, 250),
      signals: this.store.signals.slice(0, 100),
      paperOrders: this.store.paperOrders.slice(0, 100),
      paperPositions: [],
      settlements: [],
      trainingCandidates: this.store.trainingCandidates.slice(0, 100),
      modelForecasts: this.store.modelForecasts.slice(0, 100),
      ensembles: this.store.ensembles.slice(0, 100),
      performance: summarizePaperOrders(this.store.paperOrders, paperPositions),
      performanceWindows: summarizePaperPerformanceWindows(paperPositions),
      learning: {
        collection: {
          quoteSnapshots: 0,
          candidateSnapshots: this.store.trainingCandidates.length,
          paperTradeExamples: this.store.paperOrders.length,
          settledPaperTradeExamples: 0,
          scanReports: this.store.scanReports.length,
          fullScans: this.store.scanReports.filter((scan) => scan.trigger !== "quote_refresh").length,
          quoteRefreshScans: this.store.scanReports.filter((scan) => scan.trigger === "quote_refresh").length,
          latestQuoteAt: null,
          latestCandidateAt: this.store.trainingCandidates[0]?.createdAt ?? null,
          latestFullScanAt: this.store.scanReports.find((scan) => scan.trigger !== "quote_refresh")?.startedAt ?? null,
          latestQuoteRefreshAt: this.store.scanReports.find((scan) => scan.trigger === "quote_refresh")?.startedAt ?? null
        },
        backtest: {
          method: "database unavailable",
          candidateSnapshots: this.store.trainingCandidates.length,
          evaluatedMarkets: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          totalCost: 0,
          totalPayout: 0,
          totalPnl: 0,
          roi: 0
        },
        recentPaperExamples: []
      },
      research: {
        days: 0,
        totals: {
          candidateSnapshots: this.store.trainingCandidates.length,
          paperTrades: this.store.paperOrders.length,
          settledTrades: 0,
          wins: 0,
          losses: 0,
          totalPnl: 0,
          roi: null
        },
        daily: [],
        qualityBuckets: [],
        variables: []
      }
    };
  }

  async persistedSummary() {
    return this.persistentStore ? this.persistentStore.dashboardSummary(this.store) : this.summary();
  }

  async learningSummary() {
    return this.persistentStore ? this.persistentStore.learningSummary() : this.summary().learning;
  }

  async strategyDecisionDashboard() {
    if (this.persistentStore) return this.persistentStore.strategyDecisionDashboard();
    return {
      statuses: {
        draft: 0,
        backtestPassed: 0,
        walkForwardPassed: 0,
        paperTesting: 0,
        paperApproved: 0,
        rejected: 0
      },
      approvedStrategies: [],
      paperTestingStrategies: [],
      rejectedStrategies: [],
      latestBacktestHealth: this.summary().learning.backtest,
      latestPaperTradingHealth: null,
      dataFreshness: {
        latestQuoteAt: null,
        latestCandidateAt: this.store.trainingCandidates[0]?.createdAt ?? null,
        latestForecastAt: this.store.forecastSnapshots[0]?.createdAt ?? null,
        latestHistoricalCandleAt: null,
        latestHistoricalTradeAt: null
      },
      warningsRequiringReview: []
    };
  }

  async nightlyResearchExport(lookbackHours = 24) {
    const now = new Date();
    const boundedLookbackHours = Math.min(168, Math.max(1, Math.floor(lookbackHours)));
    const since = new Date(now.getTime() - boundedLookbackHours * 60 * 60 * 1000);
    if (this.persistentStore) return this.persistentStore.nightlyResearchExport({ since, until: now, lookbackHours: boundedLookbackHours });
    const summary = this.summary();
    return {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      window: {
        since: since.toISOString(),
        until: now.toISOString(),
        lookbackHours: boundedLookbackHours
      },
      source: "memory",
      collection: summary.learning.collection,
      strategyDecisionEngine: await this.strategyDecisionDashboard(),
      recentScans: summary.scanReports.slice(0, 10),
      recentPaperOrders: summary.paperOrders.slice(0, 20),
      candidateSamples: summary.trainingCandidates.slice(0, 25),
      codexBrief: {
        objective: "Evaluate whether today's ForecastEdge data justifies a focused algorithm/config change.",
        recommendedAction: "Do not change production strategy code from memory-only data; configure DATABASE_URL and use the persistent export.",
        changePolicy: "Only edit algorithm code when data quality, walk-forward validation, and paper-trading evidence support the change. Otherwise document the blocker.",
        validationRequired: ["npm run typecheck", "npm run lint", "npm test", "npm run build:api", "npm run build:web", "npm run smoke"]
      }
    };
  }

  async runStoredBacktest(parameters: Record<string, unknown> = {}) {
    if (!this.persistentStore) {
      return { id: "memory_backtest", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), summary: this.summary().learning.backtest };
    }
    return this.persistentStore.runStoredBacktest(parameters);
  }

  async runStrategyOptimizer(parameters: Record<string, unknown> = {}) {
    if (!this.persistentStore) {
      return {
        id: "memory_optimizer",
        status: "skipped",
        recommendation: this.persistenceDisabledReason ?? "DATABASE_URL is required for strategy optimization.",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        searchSpace: {},
        champion: null,
        bestCandidate: null,
        challengers: []
      };
    }
    return this.persistentStore.runStrategyOptimizer(parameters);
  }

  async runDailyAlphaReport(parameters: Record<string, unknown> = {}) {
    if (!this.persistentStore) {
      return {
        id: "memory_alpha_report",
        status: "skipped",
        recommendation: this.persistenceDisabledReason ?? "DATABASE_URL is required for daily alpha reporting.",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        searchSpace: {},
        champion: null,
        bestCandidate: null,
        challengers: []
      };
    }
    return this.persistentStore.runDailyAlphaReport(parameters);
  }

  async exportLearningDataset() {
    if (!this.persistentStore) {
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        description: "ForecastEdge in-memory export. Configure DATABASE_URL for complete persistent history.",
        counts: {
          scanReports: this.store.scanReports.length,
          quoteSnapshots: 0,
          candidateSnapshots: this.store.trainingCandidates.length,
          paperTradeExamples: this.store.paperOrders.length
        },
        tables: {
          scanReports: this.store.scanReports,
          candidateDecisionSnapshots: this.store.trainingCandidates,
          paperOrders: this.store.paperOrders,
          markets: this.store.markets,
          mappings: this.store.mappings,
          modelForecasts: this.store.modelForecasts,
          ensembleForecasts: this.store.ensembles,
          stationObservations: this.store.stationObservations,
          forecastSnapshots: this.store.forecastSnapshots
        },
        modelTrainingRows: this.store.trainingCandidates
      };
    }
    return this.persistentStore.exportLearningDataset();
  }

  exportLearningDatasetStream() {
    if (this.persistentStore) return this.persistentStore.exportLearningDatasetStream();
    return Readable.from([
      JSON.stringify({
        type: "manifest",
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        format: "ndjson",
        description: "ForecastEdge in-memory export. Configure DATABASE_URL for complete persistent history.",
        counts: {
          scanReports: this.store.scanReports.length,
          quoteSnapshots: 0,
          candidateSnapshots: this.store.trainingCandidates.length,
          paperTradeExamples: this.store.paperOrders.length
        }
      }) + "\n",
      JSON.stringify({ type: "row", table: "scan_reports", data: this.store.scanReports }) + "\n",
      JSON.stringify({ type: "row", table: "candidate_decision_snapshots", data: this.store.trainingCandidates }) + "\n",
      JSON.stringify({ type: "row", table: "paper_orders", data: this.store.paperOrders }) + "\n"
    ], { encoding: "utf8" });
  }

  async refreshQuoteCandidates(trigger: "manual" | "quote_refresh" = "manual") {
    const report = this.store.startScan(trigger);
    const candidateConfig = await this.trainingCandidateConfig();
    const candidateSource = this.store.trainingCandidates.length > 0 ? "stored_candidates" : "derived_candidates";
    const existingCandidates = candidateSource === "stored_candidates"
      ? this.store.trainingCandidates
      : buildTrainingCandidates({
        scanId: report.id,
        markets: this.store.markets,
        mappings: this.store.mappings,
        ensembles: this.store.ensembles,
        config: candidateConfig
      });
    const candidateTickers = existingCandidates
      .filter((candidate) => candidate.status === "WOULD_BUY" || candidate.status === "WATCH")
      .map((candidate) => candidate.marketTicker);
    const heldTickers = this.store.paperOrders
      .filter((order) => order.filledContracts > 0)
      .map((order) => order.marketTicker);
    const tickers = [...new Set([...candidateTickers, ...heldTickers])].slice(0, quoteRefreshTickerLimit());

    if (tickers.length === 0) {
      report.providerResults.push({ provider: "kalshi_quotes", locationId: "quotes", status: "skipped", message: "No would-buy or watch candidates to refresh yet" });
      report.counts.trainingCandidates = existingCandidates.length;
      this.finishReport(report);
      await this.persist(report);
      return {
        trigger,
        candidateSource,
        tickersConsidered: 0,
        tickersRefreshed: 0,
        refreshedMarkets: 0,
        wouldBuy: 0,
        watch: 0,
        paperOrders: 0,
        errors: 0,
        summary: this.summary()
      };
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
      config: candidateConfig
    });
    report.counts.trainingCandidates = this.store.trainingCandidates.length;

    const refreshedTickerSet = new Set(tickers);
    const wouldBuy = this.store.trainingCandidates.filter((candidate) => refreshedTickerSet.has(candidate.marketTicker) && candidate.status === "WOULD_BUY");
    const watch = this.store.trainingCandidates.filter((candidate) => refreshedTickerSet.has(candidate.marketTicker) && candidate.status === "WATCH");
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
    const errors = report.providerResults.filter((result) => result.provider === "kalshi_quotes" && result.status === "error").length;
    return {
      trigger,
      candidateSource,
      tickersConsidered: tickers.length,
      tickersRefreshed: refreshedMarkets.length,
      refreshedMarkets: refreshedMarkets.length,
      wouldBuy: wouldBuy.length,
      watch: watch.length,
      paperOrders: report.counts.paperOrders,
      errors,
      summary: this.summary()
    };
  }

  async buyPaperCandidate(marketTicker: string) {
    const ticker = marketTicker.trim().toUpperCase();
    const report = this.store.startScan("quote_refresh");
    let bought = false;
    let reason = "No paper order was created";
    let status = "UNAVAILABLE";

    try {
      const market = await getMarketDetails(ticker);
      if (!market) {
        reason = "Market details unavailable";
        report.providerResults.push({ provider: "kalshi_quotes", locationId: ticker, status: "error", message: reason });
        report.decisions.push({ stage: "paper_order", itemId: ticker, status: "skipped", reason, metadata: { marketTicker: ticker } });
      } else {
        this.mergeMarkets([market]);
        const mapping = parseKalshiWeatherMarket(market);
        this.mergeMappings([mapping]);
        report.providerResults.push({ provider: "kalshi_quotes", locationId: ticker, status: "ok", message: `Refreshed quote for ${ticker}` });
        report.counts.marketsDiscovered = 1;
        report.counts.mappingsAccepted = mapping.accepted ? 1 : 0;
        report.counts.mappingsRejected = mapping.accepted ? 0 : 1;

        this.store.trainingCandidates = buildTrainingCandidates({
          scanId: report.id,
          markets: this.store.markets,
          mappings: this.store.mappings,
          ensembles: this.store.ensembles,
          config: await this.trainingCandidateConfig()
        });
        report.counts.trainingCandidates = this.store.trainingCandidates.length;

        const candidate = this.store.trainingCandidates.find((item) => item.marketTicker === ticker);
        status = candidate?.status ?? "UNAVAILABLE";
        if (!candidate) {
          reason = "The refreshed market did not match a model candidate";
          report.decisions.push({ stage: "training_candidate", itemId: ticker, status: "skipped", reason, metadata: { market } });
        } else if (candidate.status !== "WOULD_BUY") {
          reason = candidate.reason;
          report.decisions.push({ stage: "training_candidate", itemId: candidate.id, status: "skipped", reason, metadata: { trainingCandidate: candidate } });
        } else if (env.APP_MODE !== "paper") {
          reason = "Paper buying is only enabled while APP_MODE is paper";
          report.decisions.push({ stage: "paper_order", itemId: ticker, status: "skipped", reason, metadata: { trainingCandidate: candidate } });
        } else {
          report.decisions.push({ stage: "training_candidate", itemId: candidate.id, status: "accepted", reason: candidate.reason, metadata: { trainingCandidate: candidate } });
          const beforeOrders = report.counts.paperOrders;
          await this.placePaperOrdersForCandidates([candidate], report, 1);
          bought = report.counts.paperOrders > beforeOrders;
          const lastDecision = [...report.decisions].reverse().find((decision) => decision.stage === "paper_order" || decision.stage === "signal");
          reason = bought ? "Paper order created" : lastDecision?.reason ?? candidate.reason;
        }
      }
    } catch (error) {
      reason = errorMessage(error);
      report.providerResults.push({ provider: "kalshi_quotes", locationId: ticker, status: "error", message: reason });
      report.decisions.push({ stage: "paper_order", itemId: ticker, status: "error", reason, metadata: { marketTicker: ticker } });
    }

    this.finishReport(report);
    await this.persist(report);
    return {
      marketTicker: ticker,
      status,
      bought,
      paperOrders: report.counts.paperOrders,
      reason,
      summary: this.summary()
    };
  }

  async runSettlementsOnly() {
    if (!this.persistentStore) return { checked: 0, settled: 0, skipped: 0, errors: 1, reason: this.persistenceDisabledReason ?? "DATABASE_URL is not configured" };
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

  private async placePaperOrdersForCandidates(candidates: TrainingCandidate[], report: ReturnType<MemoryStore["startScan"]>, maxOrders = paperOrderLimit()) {
    let placed = 0;
    for (const candidate of rankPurchaseCandidates(candidates)) {
      if (placed >= maxOrders) break;
      if (this.hasPaperExposure(candidate.marketTicker)) {
        report.decisions.push({ stage: "paper_order", itemId: candidate.marketTicker, status: "skipped", reason: "Already holding a filled paper position for this market", metadata: { trainingCandidate: candidate } });
        continue;
      }
      const mapping = this.store.mappings.find((item) => item.marketTicker === candidate.marketTicker);
      const market = this.store.markets.find((item) => item.ticker === candidate.marketTicker);
      if (!mapping || !market || candidate.entryPrice === null || candidate.netEdge === null || candidate.qualityScore === null) {
        report.decisions.push({ stage: "paper_order", itemId: candidate.marketTicker, status: "skipped", reason: "Incomplete candidate data; cannot size paper order", metadata: { trainingCandidate: candidate, mapping, market } });
        continue;
      }
      if ((candidate.recommendedContracts ?? 0) <= 0) {
        report.decisions.push({ stage: "paper_order", itemId: candidate.marketTicker, status: "skipped", reason: "Quality sizing recommended no fillable contracts", metadata: { trainingCandidate: candidate } });
        continue;
      }

      const now = new Date();
      const signal = candidateSignal(candidate, now);
      const risk = checkRisk(
        signal,
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
    const exposureByCity: Record<string, number> = {};
    const exposureByWeatherType: Record<string, number> = {};
    const exposureByCorrelationKey: Record<string, number> = {};
    for (const order of filledOrders) {
      const mapping = this.store.mappings.find((item) => item.marketTicker === order.marketTicker);
      const market = this.store.markets.find((item) => item.ticker === order.marketTicker);
      const cost = (order.simulatedAvgFillPrice ?? order.limitPrice) * order.filledContracts;
      const city = mapping?.location?.city ?? "unknown";
      const variable = mapping?.variable ?? "unknown";
      const correlationKey = `${city}:${mapping?.targetDate ?? "unknown"}:${variable}:${market?.eventTicker ?? order.marketTicker}`;
      exposureByCity[city] = (exposureByCity[city] ?? 0) + cost;
      exposureByWeatherType[variable] = (exposureByWeatherType[variable] ?? 0) + cost;
      exposureByCorrelationKey[correlationKey] = (exposureByCorrelationKey[correlationKey] ?? 0) + cost;
    }
    return {
      realizedPnlToday: 0,
      tradesToday: this.store.paperOrders.filter((order) => order.timestamp.slice(0, 10) === today).length,
      openExposure: filledOrders.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? order.limitPrice) * order.filledContracts, 0),
      openPositions: new Set(filledOrders.map((order) => `${order.marketTicker}:${order.side}`)).size,
      losingStreak: 0,
      exposureByCity,
      exposureByWeatherType,
      exposureByCorrelationKey
    };
  }

  private finishReport(report: ReturnType<MemoryStore["startScan"]>) {
    report.completedAt = new Date().toISOString();
    report.status = report.decisions.some((decision) => decision.status === "error") ? "completed_with_errors" : "completed";
    report.providerResults = report.providerResults.slice(0, 200);
    report.decisions = report.decisions.slice(0, 500);
    this.store.pruneHistory();
    this.audit.record({
      actor: "system",
      type: "scan_completed",
      message: `Scan ${report.id} completed: ${report.counts.marketsDiscovered} markets, ${report.counts.mappingsAccepted} accepted mappings, ${report.counts.signalsFired} fired signals`,
      metadata: {
        reportId: report.id,
        trigger: report.trigger,
        status: report.status,
        counts: report.counts,
        completedAt: report.completedAt
      }
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

  private async trainingCandidateConfig(): Promise<TrainingCandidateConfig> {
    const base = baseTrainingCandidateConfig();
    return this.persistentStore ? this.persistentStore.learnedTrainingCandidateConfig(base) : base;
  }
}

function baseTrainingCandidateConfig(): TrainingCandidateConfig {
  return {
    minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100,
    minNetEdge: 0.03,
    minQualityScore: activeRiskLimits.minQualityScore,
    maxSpread: activeRiskLimits.maxSpread,
    minLiquidityScore: activeRiskLimits.minLiquidityScore,
    maxStake: env.MAX_STAKE_PER_TRADE_PAPER,
    maxContracts: activeRiskLimits.maxContractsPerTrade
  };
}

function paperOrderLimit() {
  return env.QUOTE_REFRESH_MAX_PAPER_ORDERS;
}

function quoteRefreshTickerLimit() {
  return env.QUOTE_REFRESH_MAX_TICKERS;
}

function rankPurchaseCandidates(candidates: TrainingCandidate[]) {
  return [...candidates].sort((a, b) => purchaseScore(b) - purchaseScore(a));
}

function purchaseScore(candidate: TrainingCandidate) {
  const quality = candidate.qualityScore ?? -1;
  const netEdge = candidate.netEdge ?? -1;
  const liquidity = candidate.liquidityScore ?? 0;
  const spread = candidate.spread ?? 0.5;
  return quality * 10_000 + netEdge * 100 + liquidity - spread;
}

function candidateSignal(candidate: TrainingCandidate, now: Date): Signal {
  const limitPrice = candidate.entryPrice ?? 1;
  const contracts = Math.max(0, Math.min(activeRiskLimits.maxContractsPerTrade, candidate.recommendedContracts ?? 0));
  return {
    id: `quote_signal_${candidate.marketTicker}_${now.getTime()}`,
    marketTicker: candidate.marketTicker,
    side: "YES",
    action: "BUY",
    contracts,
    limitPrice,
    maxCost: Number((contracts * limitPrice).toFixed(4)),
    edge: candidate.grossEdge ?? candidate.edge ?? 0,
    rawYesProbability: candidate.rawYesProbability ?? null,
    calibratedYesProbability: candidate.calibratedYesProbability ?? candidate.yesProbability ?? null,
    grossEdge: candidate.grossEdge ?? candidate.edge ?? null,
    expectedSlippage: candidate.expectedSlippage ?? null,
    spreadPenalty: candidate.spreadPenalty ?? null,
    feePenalty: candidate.feePenalty ?? null,
    netEdge: candidate.netEdge ?? null,
    uncertaintyPenalty: candidate.uncertaintyPenalty ?? null,
    fillPenalty: candidate.fillPenalty ?? null,
    diversificationPenalty: candidate.diversificationPenalty ?? null,
    qualityScore: candidate.qualityScore ?? null,
    kellyFraction: candidate.kellyFraction ?? null,
    recommendedStake: candidate.recommendedStake ?? null,
    recommendedContracts: candidate.recommendedContracts ?? null,
    rankingReason: candidate.rankingReason ?? null,
    confidence: "medium",
    explanation: `Quote refresh would buy ${candidate.marketTicker}: ${candidate.reason}. Final size ${contracts} contracts / $${(contracts * limitPrice).toFixed(2)}.`,
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
