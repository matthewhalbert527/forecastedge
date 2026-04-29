import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  buildPaperPositionsFromOrders,
  calculateExpectancyMetrics,
  defaultStrategyApprovalThresholds,
  detectAntiOverfitting,
  evaluateStrategyApproval,
  scoreDataQuality,
  summarizePaperOrders,
  summarizePaperValidation,
  type EnsembleForecast,
  type ForecastDelta,
  type KalshiMarketCandidate,
  type MarketMapping,
  type ModelForecastPoint,
  type NormalizedForecastSnapshot,
  type PaperOrder,
  type PaperValidationTrade,
  type Settlement,
  type Signal,
  type StrategyApprovalDecision,
  type StrategyTradeResult,
  type StrategyValidationMode,
  type TrainingCandidate
} from "@forecastedge/core";
import type { AuditEntry } from "../audit/audit-log.js";
import { activeRiskLimits, env } from "../config/env.js";
import type { ScanReport, StationObservation, MemoryStore } from "./store.js";
import { buildTrainingCandidates } from "../jobs/training-candidates.js";
import type { KalshiCandlestick, KalshiHistoricalMarket, KalshiTradePrint } from "../kalshi/client.js";

type PrismaJson = Prisma.InputJsonValue;

export class PersistentStore {
  constructor(private readonly prisma: PrismaClient) {}

  async hydrateMemory(store: MemoryStore) {
    const [snapshots, deltas, markets, mappings, signals, orders, stationObservations, scanReports, modelForecasts, ensembles] = await Promise.all([
      this.prisma.forecastSnapshot.findMany({ include: { location: true }, orderBy: { createdAt: "desc" }, take: 200 }),
      this.prisma.forecastDelta.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.kalshiMarket.findMany({ orderBy: { updatedAt: "desc" }, take: 200 }),
      this.prisma.marketMapping.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
      this.prisma.signal.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.paperOrder.findMany({ orderBy: { timestamp: "desc" }, take: 200 }),
      this.prisma.stationObservation.findMany({ orderBy: { observedAt: "desc" }, take: 100 }),
      this.prisma.scanReport.findMany({ orderBy: { startedAt: "desc" }, take: 50 }),
      this.prisma.modelForecast.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      this.prisma.ensembleForecast.findMany({ orderBy: { createdAt: "desc" }, take: 500 })
    ]);

    store.forecastSnapshots = snapshots.map((snapshot) => ({
      id: snapshot.id,
      provider: snapshot.provider as NormalizedForecastSnapshot["provider"],
      location: {
        id: snapshot.location.id,
        city: snapshot.location.city,
        state: snapshot.location.state,
        latitude: snapshot.location.latitude,
        longitude: snapshot.location.longitude,
        timezone: snapshot.location.timezone,
        pollingIntervalMinutes: snapshot.location.pollingIntervalMinutes,
        stationId: snapshot.location.stationId ?? undefined,
        stationName: snapshot.location.stationName ?? undefined,
        settlementSource: snapshot.location.settlementSource as NormalizedForecastSnapshot["location"]["settlementSource"],
        accuweatherLocationKey: snapshot.location.accuweatherLocationKey ?? undefined
      },
      forecastRunAt: snapshot.forecastRunAt.toISOString(),
      hourly: snapshot.hourly as unknown as NormalizedForecastSnapshot["hourly"],
      daily: snapshot.targetDays as unknown as NormalizedForecastSnapshot["daily"],
      rawPayload: snapshot.rawPayload,
      createdAt: snapshot.createdAt.toISOString()
    }));
    store.forecastDeltas = deltas.map(fromPrismaDelta);
    store.markets = markets.map(fromPrismaMarket);
    store.mappings = mappings.map(fromPrismaMapping);
    store.signals = signals.map(fromPrismaSignal);
    store.paperOrders = orders.map(fromPrismaPaperOrder);
    store.stationObservations = stationObservations.map((obs) => ({
      stationId: obs.stationId,
      stationName: obs.stationName,
      observedAt: obs.observedAt.toISOString(),
      temperatureF: obs.temperatureF,
      rawPayload: obs.rawPayload
    }));
    store.scanReports = scanReports.map((scan) => ({
      id: scan.id,
      startedAt: scan.startedAt.toISOString(),
      completedAt: scan.completedAt?.toISOString() ?? null,
      status: scan.status as ScanReport["status"],
      trigger: scan.trigger as ScanReport["trigger"],
      providerResults: scan.providerResults as unknown as ScanReport["providerResults"],
      counts: scan.counts as unknown as ScanReport["counts"],
      decisions: scan.decisions as unknown as ScanReport["decisions"]
    }));
    store.modelForecasts = modelForecasts.map(fromPrismaModelForecast);
    store.ensembles = ensembles.map(fromPrismaEnsemble);
  }

  async persistScanState(store: MemoryStore, report: ScanReport, auditEntries: AuditEntry[]) {
    await this.persistLocations(store);
    await this.persistForecastSnapshots(store.forecastSnapshots);
    await this.persistStationObservations(store.stationObservations);
    await this.persistModelForecasts(store.modelForecasts);
    await this.persistEnsembles(store.ensembles);
    await this.persistForecastDeltas(store.forecastDeltas);
    await this.persistMarkets(store.markets);
    await this.persistMappings(store.mappings);
    await this.persistQuoteSnapshots(marketsForQuoteSnapshots(store.markets, report), report);
    await this.persistCandidateSnapshots(store.trainingCandidates, report);
    await this.persistSignals(store.signals, report);
    await this.persistPaperOrders(store.paperOrders);
    await this.rebuildPaperPositions();
    await this.syncPaperTrainingExamples();
    await this.persistAudit(auditEntries);
    await this.persistScanReport(report);
  }

  async dashboardSummary(fallback: MemoryStore) {
    const [scanReports, snapshots, stationObservations, deltas, markets, mappings, signals, paperOrders, positions, settlements, auditLogs, modelForecasts, ensembles] = await Promise.all([
      this.prisma.scanReport.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
      this.prisma.forecastSnapshot.findMany({ include: { location: true }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.stationObservation.findMany({ orderBy: { observedAt: "desc" }, take: 20 }),
      this.prisma.forecastDelta.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.kalshiMarket.findMany({ orderBy: { updatedAt: "desc" }, take: 250 }),
      this.prisma.marketMapping.findMany({ orderBy: { createdAt: "desc" }, take: 250 }),
      this.prisma.signal.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.paperOrder.findMany({ orderBy: { timestamp: "desc" }, take: 100 }),
      this.prisma.paperPosition.findMany({ orderBy: { openedAt: "desc" }, take: 100 }),
      this.prisma.settlement.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.modelForecast.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.ensembleForecast.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
    ]);

    const heldMarketTickers = [...new Set([...paperOrders.map((order) => order.marketTicker), ...positions.map((position) => position.marketTicker)])];
    const heldMarkets = heldMarketTickers.length > 0 ? await this.prisma.kalshiMarket.findMany({ where: { ticker: { in: heldMarketTickers } } }) : [];
    const heldMappings = heldMarketTickers.length > 0 ? await this.prisma.marketMapping.findMany({ where: { marketTicker: { in: heldMarketTickers } } }) : [];

    const typedOrders = paperOrders.map(fromPrismaPaperOrder);
    const typedPositions = positions.map((position) => ({
      id: position.id,
      marketTicker: position.marketTicker,
      side: position.side as "YES" | "NO",
      contracts: position.contracts,
      avgEntryPrice: position.avgEntryPrice,
      markPrice: position.markPrice,
      realizedPnl: position.realizedPnl,
      openedAt: position.openedAt.toISOString(),
      closedAt: position.closedAt?.toISOString() ?? null,
      settlementId: position.settlementId
    }));
    const typedSettlements = settlements.map(fromPrismaSettlement);
    const typedMarkets = uniqueBy([...markets, ...heldMarkets], (market) => market.ticker).map(fromPrismaMarket);
    const typedMappings = uniqueBy([...mappings, ...heldMappings], (mapping) => mapping.marketTicker).map(fromPrismaMapping);
    const typedEnsembles = ensembles.map(fromPrismaEnsemble);
    const trainingCandidates = buildTrainingCandidates({
      scanId: scanReports[0]?.id ?? "latest",
      markets: typedMarkets,
      mappings: typedMappings,
      ensembles: typedEnsembles,
      settlements: typedSettlements,
      config: {
        minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100,
        maxSpread: activeRiskLimits.maxSpread,
        minLiquidityScore: activeRiskLimits.minLiquidityScore
      }
    });

    const [learning, strategyDecisionEngine] = await Promise.all([
      this.learningSummary(),
      this.strategyDecisionDashboard()
    ]);

    return {
      locations: fallback.locations,
      scanReports: scanReports.map((scan) => ({
        id: scan.id,
        startedAt: scan.startedAt.toISOString(),
        completedAt: scan.completedAt?.toISOString() ?? null,
        status: scan.status,
        trigger: scan.trigger,
        providerResults: scan.providerResults,
        counts: scan.counts,
        decisions: scan.decisions
      })),
      forecastSnapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        provider: snapshot.provider,
        createdAt: snapshot.createdAt.toISOString(),
        daily: snapshot.targetDays
      })),
      stationObservations: stationObservations.map((obs) => ({
        stationId: obs.stationId,
        stationName: obs.stationName,
        observedAt: obs.observedAt.toISOString(),
        temperatureF: obs.temperatureF
      })),
      forecastDeltas: deltas.map(fromPrismaDelta),
      markets: typedMarkets,
      mappings: typedMappings,
      signals: signals.map(fromPrismaSignal),
      paperOrders: typedOrders,
      paperPositions: typedPositions,
      settlements: typedSettlements,
      trainingCandidates,
      modelForecasts: modelForecasts.map(fromPrismaModelForecast),
      ensembles: typedEnsembles,
      performance: summarizePaperOrders(typedOrders, typedPositions, typedSettlements),
      learning,
      strategyDecisionEngine,
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        timestamp: log.createdAt.toISOString(),
        type: log.type,
        message: log.message
      }))
    };
  }

  async persistSettlement(settlement: Settlement) {
    await this.prisma.settlement.upsert({
      where: { marketTicker: settlement.marketTicker },
      create: {
        id: settlement.id,
        marketTicker: settlement.marketTicker,
        result: settlement.result,
        settledPrice: settlement.settledPrice,
        source: settlement.source,
        rawPayload: toJson(settlement.rawPayload)
      },
      update: {
        result: settlement.result,
        settledPrice: settlement.settledPrice,
        source: settlement.source,
        rawPayload: toJson(settlement.rawPayload)
      }
    });
    await this.rebuildPaperPositions();
    await this.syncPaperTrainingExamples();
  }

  async learningSummary() {
    const [quoteSnapshots, candidateSnapshots, paperExamples, settledPaperExamples, scanReports, fullScans, quoteRefreshScans, historicalMarkets, historicalCandlesticks, historicalTrades, latestQuote, latestCandidate, latestFullScan, latestQuoteRefresh, recentExamples] = await Promise.all([
      this.prisma.marketQuoteSnapshot.count(),
      this.prisma.candidateDecisionSnapshot.count(),
      this.prisma.paperTradeTrainingExample.count(),
      this.prisma.paperTradeTrainingExample.count({ where: { status: { in: ["won", "lost"] } } }),
      this.prisma.scanReport.count(),
      this.prisma.scanReport.count({ where: { trigger: { not: "quote_refresh" } } }),
      this.prisma.scanReport.count({ where: { trigger: "quote_refresh" } }),
      this.prisma.historicalKalshiMarket.count(),
      this.prisma.kalshiMarketCandlestick.count(),
      this.prisma.kalshiMarketTrade.count(),
      this.prisma.marketQuoteSnapshot.findFirst({ orderBy: { observedAt: "desc" }, select: { observedAt: true } }),
      this.prisma.candidateDecisionSnapshot.findFirst({ orderBy: { observedAt: "desc" }, select: { observedAt: true } }),
      this.prisma.scanReport.findFirst({ where: { trigger: { not: "quote_refresh" } }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
      this.prisma.scanReport.findFirst({ where: { trigger: "quote_refresh" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
      this.prisma.paperTradeTrainingExample.findMany({ orderBy: { openedAt: "desc" }, take: 20 })
    ]);

    const backtest = await this.backtestStoredWouldBuys();
    return {
      collection: {
        quoteSnapshots,
        candidateSnapshots,
        paperTradeExamples: paperExamples,
        settledPaperTradeExamples: settledPaperExamples,
        scanReports,
        fullScans,
        quoteRefreshScans,
        historicalMarkets,
        historicalCandlesticks,
        historicalTrades,
        latestQuoteAt: latestQuote?.observedAt.toISOString() ?? null,
        latestCandidateAt: latestCandidate?.observedAt.toISOString() ?? null,
        latestFullScanAt: latestFullScan?.startedAt.toISOString() ?? null,
        latestQuoteRefreshAt: latestQuoteRefresh?.startedAt.toISOString() ?? null
      },
      backtest,
      recentPaperExamples: recentExamples.map((example) => ({
        orderId: example.orderId,
        marketTicker: example.marketTicker,
        openedAt: example.openedAt.toISOString(),
        status: example.status,
        entryPrice: example.entryPrice,
        contracts: example.filledContracts,
        cost: example.cost,
        modelProbability: example.modelProbability,
        impliedProbability: example.impliedProbability,
        edge: example.edge,
        settlementResult: example.settlementResult,
        pnl: example.pnl,
        roi: example.roi
      }))
    };
  }

  async strategyDecisionDashboard() {
    const [versions, runs, latestOptimizer, latestQuote, latestCandidate, latestForecast, latestHistoricalCandle, latestHistoricalTrade] = await Promise.all([
      this.prisma.strategyVersion.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } }
      }),
      this.prisma.strategyRun.findMany({ orderBy: { startedAt: "desc" }, take: 25 }),
      this.prisma.strategyOptimizationRun.findFirst({ orderBy: { startedAt: "desc" } }),
      this.prisma.marketQuoteSnapshot.findFirst({ orderBy: { observedAt: "desc" }, select: { observedAt: true } }),
      this.prisma.candidateDecisionSnapshot.findFirst({ orderBy: { observedAt: "desc" }, select: { observedAt: true } }),
      this.prisma.forecastSnapshot.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      this.prisma.kalshiMarketCandlestick.findFirst({ orderBy: { endPeriodAt: "desc" }, select: { endPeriodAt: true } }),
      this.prisma.kalshiMarketTrade.findFirst({ orderBy: { createdTime: "desc" }, select: { createdTime: true } })
    ]);
    const latestByStrategy = latestVersionsByStrategy(versions);
    const strategyRows = latestByStrategy.map((version) => strategyVersionDashboardRow(version));
    const latestRun = runs[0] ?? null;
    const latestSummary = jsonRecord(latestRun?.summary);
    const warnings = runs.flatMap((run) => strategyRunWarnings(run)).slice(0, 20);

    return {
      statuses: {
        draft: strategyRows.filter((row) => row.approvalStatus === "Draft").length,
        backtestPassed: strategyRows.filter((row) => row.approvalStatus === "Backtest Passed").length,
        walkForwardPassed: strategyRows.filter((row) => row.approvalStatus === "Walk-Forward Passed").length,
        paperTesting: strategyRows.filter((row) => row.approvalStatus === "Paper Testing").length,
        paperApproved: strategyRows.filter((row) => row.approvalStatus === "Paper Approved").length,
        rejected: strategyRows.filter((row) => row.approvalStatus === "Rejected").length
      },
      approvedStrategies: strategyRows.filter((row) => row.approvalStatus === "Paper Approved"),
      paperTestingStrategies: strategyRows.filter((row) => row.approvalStatus === "Paper Testing" || row.approvalStatus === "Walk-Forward Passed" || row.approvalStatus === "Backtest Passed"),
      rejectedStrategies: strategyRows.filter((row) => row.approvalStatus === "Rejected"),
      latestBacktestHealth: latestRun ? {
        runId: latestRun.id,
        strategyVersionId: latestRun.strategyVersionId,
        approvalStatus: latestRun.approvalStatus,
        evaluatedMarkets: numberField(latestSummary, "evaluatedMarkets"),
        roi: numberField(latestSummary, "roi"),
        totalPnl: numberField(latestSummary, "totalPnl"),
        dataQualityScore: latestRun.dataQualityScore,
        completedAt: latestRun.completedAt?.toISOString() ?? null
      } : null,
      latestPaperTradingHealth: paperHealthFromSummary(latestSummary),
      latestOptimizerReport: latestOptimizer ? {
        id: latestOptimizer.id,
        status: latestOptimizer.status,
        recommendation: latestOptimizer.recommendation,
        searchSpace: latestOptimizer.searchSpace,
        champion: latestOptimizer.champion,
        bestCandidate: latestOptimizer.bestCandidate,
        challengers: latestOptimizer.challengers,
        startedAt: latestOptimizer.startedAt.toISOString(),
        completedAt: latestOptimizer.completedAt?.toISOString() ?? null
      } : null,
      dataFreshness: {
        latestQuoteAt: latestQuote?.observedAt.toISOString() ?? null,
        latestCandidateAt: latestCandidate?.observedAt.toISOString() ?? null,
        latestForecastAt: latestForecast?.createdAt.toISOString() ?? null,
        latestHistoricalCandleAt: latestHistoricalCandle?.endPeriodAt.toISOString() ?? null,
        latestHistoricalTradeAt: latestHistoricalTrade?.createdTime.toISOString() ?? null
      },
      warningsRequiringReview: warnings
    };
  }

  private async dataSourceVersion() {
    const [candidateCount, candleCount, tradeCount, latestCandidate, latestCandle, latestTrade] = await Promise.all([
      this.prisma.candidateDecisionSnapshot.count(),
      this.prisma.kalshiMarketCandlestick.count(),
      this.prisma.kalshiMarketTrade.count(),
      this.prisma.candidateDecisionSnapshot.findFirst({ orderBy: { observedAt: "desc" }, select: { observedAt: true } }),
      this.prisma.kalshiMarketCandlestick.findFirst({ orderBy: { endPeriodAt: "desc" }, select: { endPeriodAt: true } }),
      this.prisma.kalshiMarketTrade.findFirst({ orderBy: { createdTime: "desc" }, select: { createdTime: true } })
    ]);
    return [
      `candidate:${candidateCount}:${latestCandidate?.observedAt.toISOString() ?? "none"}`,
      `candles:${candleCount}:${latestCandle?.endPeriodAt.toISOString() ?? "none"}`,
      `trades:${tradeCount}:${latestTrade?.createdTime.toISOString() ?? "none"}`
    ].join("|");
  }

  private async firstPaperTradeDate() {
    const first = await this.prisma.paperTradeTrainingExample.findFirst({ orderBy: { openedAt: "asc" }, select: { openedAt: true } });
    return first?.openedAt ?? null;
  }

  private async paperValidationFor(expectancy: ReturnType<typeof calculateExpectancyMetrics>) {
    const examples = await this.prisma.paperTradeTrainingExample.findMany({
      include: { order: true },
      orderBy: { openedAt: "desc" },
      take: 1000
    });
    const trades: PaperValidationTrade[] = examples.map((example) => {
      const actualFillPrice = example.entryPrice ?? null;
      const expectedEntryPrice = example.limitPrice;
      const actualSlippage = actualFillPrice === null ? null : Number((actualFillPrice - example.limitPrice).toFixed(4));
      return {
        orderId: example.orderId,
        marketTicker: example.marketTicker,
        expectedEntryPrice,
        actualFillPrice,
        expectedSlippage: 0.01,
        actualSlippage,
        expectedPnl: expectedPaperPnl(example),
        actualPnl: example.pnl,
        expectedWinProbability: example.modelProbability,
        status: paperValidationStatus(example.status),
        skippedReason: example.filledContracts > 0 ? null : example.order.reason,
        signalGenerated: true,
        filled: example.filledContracts > 0,
        edgeDisappeared: example.edge !== null && example.edge <= 0,
        openedAt: example.openedAt.toISOString()
      };
    });
    return summarizePaperValidation(trades, expectancy, defaultStrategyApprovalThresholds);
  }

  async exportLearningDataset() {
    const [
      locations,
      scanReports,
      quoteSnapshots,
      candidateSnapshots,
      paperExamples,
      paperOrders,
      paperPositions,
      settlements,
      signals,
      markets,
      mappings,
      forecastSnapshots,
      stationObservations,
      modelForecasts,
      ensembles,
      historicalMarkets,
      marketCandlesticks,
      marketTrades,
      strategyVersions,
      strategyRuns,
      strategyOptimizationRuns
    ] = await Promise.all([
      this.prisma.location.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.scanReport.findMany({ orderBy: { startedAt: "asc" } }),
      this.prisma.marketQuoteSnapshot.findMany({ orderBy: [{ observedAt: "asc" }, { marketTicker: "asc" }] }),
      this.prisma.candidateDecisionSnapshot.findMany({ orderBy: [{ observedAt: "asc" }, { marketTicker: "asc" }] }),
      this.prisma.paperTradeTrainingExample.findMany({ orderBy: { openedAt: "asc" } }),
      this.prisma.paperOrder.findMany({ orderBy: { timestamp: "asc" } }),
      this.prisma.paperPosition.findMany({ orderBy: { openedAt: "asc" } }),
      this.prisma.settlement.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.signal.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.kalshiMarket.findMany({ orderBy: { updatedAt: "asc" } }),
      this.prisma.marketMapping.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.forecastSnapshot.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.stationObservation.findMany({ orderBy: { observedAt: "asc" } }),
      this.prisma.modelForecast.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.ensembleForecast.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.historicalKalshiMarket.findMany({ orderBy: { fetchedAt: "asc" } }),
      this.prisma.kalshiMarketCandlestick.findMany({ orderBy: [{ endPeriodAt: "asc" }, { marketTicker: "asc" }] }),
      this.prisma.kalshiMarketTrade.findMany({ orderBy: [{ createdTime: "asc" }, { marketTicker: "asc" }] }),
      this.prisma.strategyVersion.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.strategyRun.findMany({ orderBy: { startedAt: "asc" } }),
      this.prisma.strategyOptimizationRun.findMany({ orderBy: { startedAt: "asc" } })
    ]);

    const settlementByTicker = new Map(settlements.map((settlement) => [settlement.marketTicker, settlement]));
    const quoteByScanAndTicker = new Map(
      quoteSnapshots
        .filter((quote) => quote.scanId)
        .map((quote) => [`${quote.scanId}:${quote.marketTicker}`, quote])
    );

    const modelTrainingRows = candidateSnapshots.map((candidate) => {
      const settlement = settlementByTicker.get(candidate.marketTicker) ?? null;
      const quote = quoteByScanAndTicker.get(`${candidate.scanId}:${candidate.marketTicker}`) ?? null;
      const contracts = candidate.entryPrice === null ? null : simulatedContracts(candidate.entryPrice);
      const cost = candidate.entryPrice === null || contracts === null ? null : Number((candidate.entryPrice * contracts).toFixed(4));
      const payout = settlement && contracts !== null ? settlementPayout("YES", settlement.result, contracts) : null;
      const pnl = payout === null || cost === null ? null : Number((payout - cost).toFixed(4));

      return {
        scanId: candidate.scanId,
        scanTrigger: candidate.scanTrigger,
        scanCadenceMinutes: candidate.scanCadenceMinutes,
        observedAt: candidate.observedAt,
        marketTicker: candidate.marketTicker,
        city: candidate.city,
        stationId: candidate.stationId,
        variable: candidate.variable,
        targetDate: candidate.targetDate,
        threshold: candidate.threshold,
        thresholdOperator: candidate.thresholdOperator,
        forecastValue: candidate.forecastValue,
        entryPrice: candidate.entryPrice,
        yesBid: quote?.yesBid ?? null,
        yesAsk: quote?.yesAsk ?? null,
        noBid: quote?.noBid ?? null,
        noAsk: quote?.noAsk ?? null,
        lastPrice: quote?.lastPrice ?? null,
        volume: quote?.volume ?? null,
        openInterest: quote?.openInterest ?? null,
        yesProbability: candidate.yesProbability,
        impliedProbability: candidate.impliedProbability,
        edge: candidate.edge,
        spread: candidate.spread,
        liquidityScore: candidate.liquidityScore,
        decision: candidate.status,
        blockers: candidate.blockers,
        reason: candidate.reason,
        settledResult: settlement?.result ?? null,
        settledPrice: settlement?.settledPrice ?? null,
        outcomeYes: settlement ? settlement.result === "yes" : null,
        simulatedContracts: contracts,
        simulatedCost: cost,
        simulatedPayout: payout,
        simulatedPnl: pnl
      };
    });

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      description: "ForecastEdge complete learning export: scan reports, quote snapshots, model decisions, paper trades, outcomes, forecasts, and joined training rows.",
      counts: {
        locations: locations.length,
        scanReports: scanReports.length,
        fullScans: scanReports.filter((scan) => scan.trigger !== "quote_refresh").length,
        quoteRefreshScans: scanReports.filter((scan) => scan.trigger === "quote_refresh").length,
        quoteSnapshots: quoteSnapshots.length,
        candidateSnapshots: candidateSnapshots.length,
        paperTradeExamples: paperExamples.length,
        modelTrainingRows: modelTrainingRows.length,
        settlements: settlements.length
      },
      tables: {
        locations,
        scanReports,
        quoteSnapshots,
        candidateDecisionSnapshots: candidateSnapshots,
        paperTradeTrainingExamples: paperExamples,
        paperOrders,
        paperPositions,
        settlements,
        signals,
        markets,
        mappings,
        forecastSnapshots,
        stationObservations,
        modelForecasts,
        ensembleForecasts: ensembles,
        historicalKalshiMarkets: historicalMarkets,
        kalshiMarketCandlesticks: marketCandlesticks.map(serializeJsonSafe),
        kalshiMarketTrades: marketTrades,
        strategyVersions,
        strategyRuns,
        strategyOptimizationRuns
      },
      modelTrainingRows
    };
  }

  exportLearningDatasetStream() {
    return Readable.from(this.learningDatasetLines(), { encoding: "utf8" });
  }

  async runStoredBacktest(parameters: Record<string, unknown> = {}) {
    const options = parseBacktestParameters(parameters);
    const summary = await this.backtestStoredWouldBuys(options);
    const strategyVersion = await this.prisma.strategyVersion.create({
      data: {
        strategyKey: options.strategyKey,
        configHash: strategyConfigHash(options),
        config: toJson(options),
        codeVersion: codeVersion(),
        dataSourceVersion: await this.dataSourceVersion(),
        backtestDate: new Date(),
        validationDate: options.validationMode === "walk_forward" || options.validationMode === "paper" ? new Date() : null,
        paperTradingStartDate: options.paperTradingStartDate ? new Date(`${options.paperTradingStartDate}T00:00:00Z`) : options.validationMode === "paper" ? await this.firstPaperTradeDate() : null,
        notes: options.notes,
        approvalStatus: summary.approval.status
      }
    });
    const run = await this.prisma.strategyRun.create({
      data: {
        strategyVersionId: strategyVersion.id,
        mode: env.APP_MODE,
        parameters: toJson({ strategy: options.strategyKey, ...options }),
        approvalStatus: summary.approval.status,
        dataQualityScore: summary.dataQuality.score,
        warnings: toJson(summary.approval.warnings),
        completedAt: new Date(),
        summary: toJson(summary)
      }
    });
    return {
      id: run.id,
      strategyVersionId: strategyVersion.id,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      summary
    };
  }

  async runStrategyOptimizer(parameters: Record<string, unknown> = {}) {
    const startedAt = new Date();
    const plan = buildOptimizerPlan(parameters);
    const before = await this.strategyDecisionDashboard();
    const champion = before.approvedStrategies[0] ?? before.paperTestingStrategies[0] ?? null;
    const challengers = [];

    for (const candidate of plan.candidates) {
      const result = await this.runStoredBacktest({
        ...candidate,
        validationMode: plan.validationMode,
        strategyKey: plan.strategyKey,
        notes: `${plan.trigger} optimizer candidate ${candidate.optimizerCandidateId}`
      });
      challengers.push(optimizerResultFromRun(result, candidate));
    }

    const ranked = [...challengers].sort((a, b) => b.score - a.score);
    const bestCandidate = ranked[0] ?? null;
    const recommendation = optimizerRecommendation(champion, bestCandidate);
    const status = bestCandidate && bestCandidate.approvalStatus !== "Rejected" ? "completed" : "completed_no_candidate";
    const completedAt = new Date();
    const row = await this.prisma.strategyOptimizationRun.create({
      data: {
        status,
        recommendation,
        searchSpace: toJson(plan.searchSpace),
        champion: toJson(champion),
        bestCandidate: toJson(bestCandidate),
        challengers: toJson(ranked),
        startedAt,
        completedAt
      }
    });

    return {
      id: row.id,
      status,
      recommendation,
      searchSpace: plan.searchSpace,
      champion,
      bestCandidate,
      challengers: ranked,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString()
    };
  }

  private async *learningDatasetLines() {
    const counts = await this.datasetCounts();
    yield ndjsonLine({
      type: "manifest",
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      format: "ndjson",
      description: "ForecastEdge complete learning export. Each line is one JSON object with a type, table, and row payload.",
      counts
    });

    yield* streamTable("locations", (skip, take) => this.prisma.location.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("scan_reports", (skip, take) => this.prisma.scanReport.findMany({ orderBy: { startedAt: "asc" }, skip, take }));
    yield* streamTable("quote_snapshots", (skip, take) => this.prisma.marketQuoteSnapshot.findMany({ orderBy: [{ observedAt: "asc" }, { marketTicker: "asc" }], skip, take }));
    yield* streamTable("candidate_decision_snapshots", (skip, take) => this.prisma.candidateDecisionSnapshot.findMany({ orderBy: [{ observedAt: "asc" }, { marketTicker: "asc" }], skip, take }));
    yield* streamTable("paper_trade_training_examples", (skip, take) => this.prisma.paperTradeTrainingExample.findMany({ orderBy: { openedAt: "asc" }, skip, take }));
    yield* streamTable("paper_orders", (skip, take) => this.prisma.paperOrder.findMany({ orderBy: { timestamp: "asc" }, skip, take }));
    yield* streamTable("paper_positions", (skip, take) => this.prisma.paperPosition.findMany({ orderBy: { openedAt: "asc" }, skip, take }));
    yield* streamTable("settlements", (skip, take) => this.prisma.settlement.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("signals", (skip, take) => this.prisma.signal.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("markets", (skip, take) => this.prisma.kalshiMarket.findMany({ orderBy: { updatedAt: "asc" }, skip, take }));
    yield* streamTable("mappings", (skip, take) => this.prisma.marketMapping.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("forecast_snapshots", (skip, take) => this.prisma.forecastSnapshot.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("station_observations", (skip, take) => this.prisma.stationObservation.findMany({ orderBy: { observedAt: "asc" }, skip, take }));
    yield* streamTable("model_forecasts", (skip, take) => this.prisma.modelForecast.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("ensemble_forecasts", (skip, take) => this.prisma.ensembleForecast.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("historical_kalshi_markets", (skip, take) => this.prisma.historicalKalshiMarket.findMany({ orderBy: { fetchedAt: "asc" }, skip, take }));
    yield* streamTable("kalshi_market_candlesticks", (skip, take) => this.prisma.kalshiMarketCandlestick.findMany({ orderBy: [{ endPeriodAt: "asc" }, { marketTicker: "asc" }], skip, take }));
    yield* streamTable("kalshi_market_trades", (skip, take) => this.prisma.kalshiMarketTrade.findMany({ orderBy: [{ createdTime: "asc" }, { marketTicker: "asc" }], skip, take }));
    yield* streamTable("strategy_versions", (skip, take) => this.prisma.strategyVersion.findMany({ orderBy: { createdAt: "asc" }, skip, take }));
    yield* streamTable("strategy_runs", (skip, take) => this.prisma.strategyRun.findMany({ orderBy: { startedAt: "asc" }, skip, take }));
    yield* streamTable("strategy_optimization_runs", (skip, take) => this.prisma.strategyOptimizationRun.findMany({ orderBy: { startedAt: "asc" }, skip, take }));
    yield* this.modelTrainingRowLines();
  }

  private async *modelTrainingRowLines() {
    const settlements = new Map((await this.prisma.settlement.findMany()).map((settlement) => [settlement.marketTicker, settlement]));
    yield ndjsonLine({ type: "table_start", table: "model_training_rows" });
    const batchSize = 500;
    for (let skip = 0; ; skip += batchSize) {
      const candidates = await this.prisma.candidateDecisionSnapshot.findMany({
        orderBy: [{ observedAt: "asc" }, { marketTicker: "asc" }],
        skip,
        take: batchSize
      });
      if (candidates.length === 0) break;
      for (const candidate of candidates) {
        const settlement = settlements.get(candidate.marketTicker) ?? null;
        const contracts = candidate.entryPrice === null ? null : simulatedContracts(candidate.entryPrice);
        const cost = candidate.entryPrice === null || contracts === null ? null : Number((candidate.entryPrice * contracts).toFixed(4));
        const payout = settlement && contracts !== null ? settlementPayout("YES", settlement.result, contracts) : null;
        const pnl = payout === null || cost === null ? null : Number((payout - cost).toFixed(4));
        yield ndjsonLine({
          type: "row",
          table: "model_training_rows",
          data: {
            scanId: candidate.scanId,
            scanTrigger: candidate.scanTrigger,
            scanCadenceMinutes: candidate.scanCadenceMinutes,
            observedAt: candidate.observedAt,
            marketTicker: candidate.marketTicker,
            city: candidate.city,
            stationId: candidate.stationId,
            variable: candidate.variable,
            targetDate: candidate.targetDate,
            threshold: candidate.threshold,
            thresholdOperator: candidate.thresholdOperator,
            forecastValue: candidate.forecastValue,
            entryPrice: candidate.entryPrice,
            yesProbability: candidate.yesProbability,
            impliedProbability: candidate.impliedProbability,
            edge: candidate.edge,
            spread: candidate.spread,
            liquidityScore: candidate.liquidityScore,
            decision: candidate.status,
            blockers: candidate.blockers,
            reason: candidate.reason,
            settledResult: settlement?.result ?? null,
            settledPrice: settlement?.settledPrice ?? null,
            outcomeYes: settlement ? settlement.result === "yes" : null,
            simulatedContracts: contracts,
            simulatedCost: cost,
            simulatedPayout: payout,
            simulatedPnl: pnl
          }
        });
      }
    }
    yield ndjsonLine({ type: "table_end", table: "model_training_rows" });
  }

  private async datasetCounts() {
    const [
      locations,
      scanReports,
      fullScans,
      quoteRefreshScans,
      quoteSnapshots,
      candidateSnapshots,
      paperTradeExamples,
      paperOrders,
      paperPositions,
      settlements,
      signals,
      markets,
      mappings,
      forecastSnapshots,
      stationObservations,
      modelForecasts,
      ensembles,
      historicalMarkets,
      marketCandlesticks,
      marketTrades,
      strategyVersions,
      strategyRuns,
      strategyOptimizationRuns
    ] = await Promise.all([
      this.prisma.location.count(),
      this.prisma.scanReport.count(),
      this.prisma.scanReport.count({ where: { trigger: { not: "quote_refresh" } } }),
      this.prisma.scanReport.count({ where: { trigger: "quote_refresh" } }),
      this.prisma.marketQuoteSnapshot.count(),
      this.prisma.candidateDecisionSnapshot.count(),
      this.prisma.paperTradeTrainingExample.count(),
      this.prisma.paperOrder.count(),
      this.prisma.paperPosition.count(),
      this.prisma.settlement.count(),
      this.prisma.signal.count(),
      this.prisma.kalshiMarket.count(),
      this.prisma.marketMapping.count(),
      this.prisma.forecastSnapshot.count(),
      this.prisma.stationObservation.count(),
      this.prisma.modelForecast.count(),
      this.prisma.ensembleForecast.count(),
      this.prisma.historicalKalshiMarket.count(),
      this.prisma.kalshiMarketCandlestick.count(),
      this.prisma.kalshiMarketTrade.count(),
      this.prisma.strategyVersion.count(),
      this.prisma.strategyRun.count(),
      this.prisma.strategyOptimizationRun.count()
    ]);

    return {
      locations,
      scanReports,
      fullScans,
      quoteRefreshScans,
      quoteSnapshots,
      candidateSnapshots,
      paperTradeExamples,
      paperOrders,
      paperPositions,
      settlements,
      signals,
      markets,
      mappings,
      forecastSnapshots,
      stationObservations,
      modelForecasts,
      ensembleForecasts: ensembles,
      historicalKalshiMarkets: historicalMarkets,
      kalshiMarketCandlesticks: marketCandlesticks,
      kalshiMarketTrades: marketTrades,
      strategyVersions,
      strategyRuns,
      strategyOptimizationRuns,
      modelTrainingRows: candidateSnapshots
    };
  }

  async openPaperPositions() {
    return this.prisma.paperPosition.findMany({ where: { closedAt: null } });
  }

  async persistAudit(entries: AuditEntry[]) {
    for (const entry of entries) {
      await this.prisma.auditLog.upsert({
        where: { id: entry.id },
        create: {
          id: entry.id,
          actor: entry.actor,
          type: entry.type,
          message: entry.message,
          metadata: toJson(entry.metadata),
          createdAt: new Date(entry.timestamp)
        },
        update: {}
      });
    }
  }

  private async persistLocations(store: MemoryStore) {
    for (const location of store.locations) {
      await this.prisma.location.upsert({
        where: { id: location.id },
        create: {
          id: location.id,
          city: location.city,
          state: location.state,
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: location.timezone,
          stationId: location.stationId ?? null,
          stationName: location.stationName ?? null,
          settlementSource: location.settlementSource ?? null,
          accuweatherLocationKey: location.accuweatherLocationKey ?? null,
          pollingIntervalMinutes: location.pollingIntervalMinutes
        },
        update: {
          city: location.city,
          state: location.state,
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: location.timezone,
          stationId: location.stationId ?? null,
          stationName: location.stationName ?? null,
          settlementSource: location.settlementSource ?? null,
          accuweatherLocationKey: location.accuweatherLocationKey ?? null,
          pollingIntervalMinutes: location.pollingIntervalMinutes,
          active: true
        }
      });
    }
  }

  private async persistForecastSnapshots(snapshots: NormalizedForecastSnapshot[]) {
    for (const snapshot of snapshots.slice(0, 250)) {
      await this.prisma.forecastSnapshot.upsert({
        where: { id: snapshot.id },
        create: {
          id: snapshot.id,
          provider: snapshot.provider,
          locationId: snapshot.location.id,
          forecastRunAt: new Date(snapshot.forecastRunAt),
          targetDays: toJson(snapshot.daily),
          hourly: toJson(snapshot.hourly),
          rawPayload: toJson(snapshot.rawPayload),
          createdAt: new Date(snapshot.createdAt)
        },
        update: {}
      });
    }
  }

  private async persistStationObservations(observations: StationObservation[]) {
    for (const obs of observations.slice(0, 250)) {
      await this.prisma.stationObservation.upsert({
        where: { id: `${obs.stationId}_${obs.observedAt}` },
        create: {
          id: `${obs.stationId}_${obs.observedAt}`,
          stationId: obs.stationId,
          stationName: obs.stationName,
          observedAt: new Date(obs.observedAt),
          temperatureF: obs.temperatureF,
          rawPayload: toJson(obs.rawPayload)
        },
        update: {}
      });
    }
  }

  private async persistModelForecasts(points: ModelForecastPoint[]) {
    for (const point of points.slice(0, 1000)) {
      await this.prisma.modelForecast.upsert({
        where: { id: point.id },
        create: modelForecastWrite(point),
        update: modelForecastWrite(point)
      });
    }
  }

  private async persistEnsembles(ensembles: EnsembleForecast[]) {
    for (const ensemble of ensembles.slice(0, 1000)) {
      await this.prisma.ensembleForecast.upsert({
        where: { id: ensemble.id },
        create: ensembleWrite(ensemble),
        update: ensembleWrite(ensemble)
      });
    }
  }

  private async persistForecastDeltas(deltas: ForecastDelta[]) {
    for (const delta of deltas.slice(0, 250)) {
      await this.prisma.forecastDelta.upsert({
        where: { id: delta.id },
        create: {
          id: delta.id,
          locationId: delta.locationId,
          variable: delta.variable,
          targetDate: new Date(`${delta.targetDate}T00:00:00Z`),
          oldValue: delta.oldValue,
          newValue: delta.newValue,
          absoluteChange: delta.absoluteChange,
          probabilityChange: delta.probabilityChange,
          timeHorizonHours: delta.timeHorizonHours,
          confidence: delta.confidence,
          reason: delta.reason,
          createdAt: new Date(delta.createdAt)
        },
        update: {}
      });
    }
  }

  async persistMarkets(markets: KalshiMarketCandidate[]) {
    for (const market of markets) {
      await this.prisma.kalshiMarket.upsert({
        where: { ticker: market.ticker },
        create: marketWrite(market),
        update: marketWrite(market)
      });
    }
  }

  async persistHistoricalMarkets(markets: KalshiHistoricalMarket[]) {
    await this.persistMarkets(markets);
    for (const market of markets) {
      await this.prisma.historicalKalshiMarket.upsert({
        where: { ticker: market.ticker },
        create: historicalMarketWrite(market),
        update: historicalMarketWrite(market)
      });
    }
  }

  async persistMarketCandlesticks(candlesticks: KalshiCandlestick[], source: "historical" | "live", periodInterval: number) {
    for (const candle of candlesticks) {
      const market = await this.prisma.kalshiMarket.findUnique({ where: { ticker: candle.marketTicker }, select: { ticker: true } });
      if (!market) continue;
      await this.prisma.kalshiMarketCandlestick.upsert({
        where: {
          marketTicker_source_periodInterval_endPeriodTs: {
            marketTicker: candle.marketTicker,
            source,
            periodInterval,
            endPeriodTs: BigInt(candle.endPeriodTs)
          }
        },
        create: candlestickWrite(candle, source, periodInterval),
        update: candlestickWrite(candle, source, periodInterval)
      });
    }
  }

  async persistMarketTrades(trades: KalshiTradePrint[], source: "historical" | "live") {
    for (const trade of trades) {
      const market = await this.prisma.kalshiMarket.findUnique({ where: { ticker: trade.marketTicker }, select: { ticker: true } });
      if (!market) continue;
      await this.prisma.kalshiMarketTrade.upsert({
        where: { id: trade.id },
        create: tradeWrite(trade, source),
        update: tradeWrite(trade, source)
      });
    }
  }

  private async persistMappings(mappings: MarketMapping[]) {
    for (const mapping of mappings) {
      await this.prisma.marketMapping.upsert({
        where: { id: mapping.marketTicker },
        create: mappingWrite(mapping),
        update: mappingWrite(mapping)
      });
    }
  }

  private async persistQuoteSnapshots(markets: KalshiMarketCandidate[], report: ScanReport) {
    const observedAt = report.startedAt;
    for (const market of markets.slice(0, 250)) {
      await this.prisma.marketQuoteSnapshot.upsert({
        where: { marketTicker_observedAt: { marketTicker: market.ticker, observedAt: new Date(observedAt) } },
        create: quoteSnapshotWrite(market, observedAt, report),
        update: quoteSnapshotWrite(market, observedAt, report)
      });
    }
  }

  private async persistCandidateSnapshots(candidates: TrainingCandidate[], report: ScanReport) {
    for (const candidate of candidates.slice(0, 250)) {
      await this.prisma.candidateDecisionSnapshot.upsert({
        where: { id: candidate.id },
        create: candidateSnapshotWrite(candidate, report),
        update: candidateSnapshotWrite(candidate, report)
      });
    }
  }

  private async persistSignals(signals: Signal[], report: ScanReport) {
    const signalDecisions = new Map(report.decisions.filter((decision) => decision.stage === "signal").map((decision) => [decision.itemId, decision]));
    const validDeltaIds = new Set((await this.prisma.forecastDelta.findMany({ select: { id: true } })).map((delta) => delta.id));
    for (const signal of signals.slice(0, 250)) {
      const decisionMetadata = signalDecisions.get(signal.id)?.metadata as { probability?: { yesProbability?: number; impliedProbability?: number }; trainingCandidate?: { yesProbability?: number | null; impliedProbability?: number | null } } | undefined;
      const probability = decisionMetadata?.probability;
      const trainingCandidate = decisionMetadata?.trainingCandidate;
      await this.prisma.signal.upsert({
        where: { id: signal.id },
        create: {
          id: signal.id,
          marketTicker: signal.marketTicker,
          forecastDeltaId: validDeltaIds.has(signal.linkedDeltaId) ? signal.linkedDeltaId : null,
          side: signal.side,
          action: signal.action,
          contracts: signal.contracts,
          limitPrice: signal.limitPrice,
          maxCost: signal.maxCost,
          modelProbability: probability?.yesProbability ?? trainingCandidate?.yesProbability ?? 0,
          impliedProbability: probability?.impliedProbability ?? trainingCandidate?.impliedProbability ?? signal.limitPrice,
          edge: signal.edge,
          confidence: signal.confidence,
          explanation: signal.explanation,
          status: signal.status,
          skipReason: signal.skipReason,
          createdAt: new Date(signal.createdAt)
        },
        update: {}
      });
    }
  }

  private async persistPaperOrders(orders: PaperOrder[]) {
    for (const order of orders.slice(0, 250)) {
      await this.prisma.paperOrder.upsert({
        where: { id: order.id },
        create: {
          id: order.id,
          signalId: order.linkedSignalId,
          timestamp: new Date(order.timestamp),
          marketTicker: order.marketTicker,
          side: order.side,
          action: order.action,
          requestedContracts: order.requestedContracts,
          limitPrice: order.limitPrice,
          simulatedAvgFillPrice: order.simulatedAvgFillPrice,
          filledContracts: order.filledContracts,
          unfilledContracts: order.unfilledContracts,
          status: order.status,
          reason: order.reason
        },
        update: {}
      });
    }
  }

  private async syncPaperTrainingExamples() {
    const orders = await this.prisma.paperOrder.findMany({ include: { signal: true }, orderBy: { timestamp: "desc" }, take: 1000 });
    const settlements = new Map((await this.prisma.settlement.findMany()).map((settlement) => [settlement.marketTicker, settlement]));

    for (const order of orders) {
      const candidate = await this.prisma.candidateDecisionSnapshot.findFirst({
        where: { marketTicker: order.marketTicker, observedAt: { lte: order.timestamp } },
        orderBy: { observedAt: "desc" }
      });
      const settlement = settlements.get(order.marketTicker) ?? null;
      const fillPrice = order.simulatedAvgFillPrice ?? order.limitPrice;
      const cost = Number((fillPrice * order.filledContracts).toFixed(4));
      const payout = settlement ? settlementPayout(order.side, settlement.result, order.filledContracts) : null;
      const pnl = payout === null ? null : Number((payout - cost).toFixed(4));
      const roi = pnl === null || cost === 0 ? null : Number((pnl / cost).toFixed(4));
      const status = settlement ? (pnl !== null && pnl >= 0 ? "won" : "lost") : order.filledContracts > 0 ? "open" : "rejected";

      await this.prisma.paperTradeTrainingExample.upsert({
        where: { orderId: order.id },
        create: {
          id: `paper_training_${order.id}`,
          orderId: order.id,
          signalId: order.signalId,
          marketTicker: order.marketTicker,
          side: order.side,
          openedAt: order.timestamp,
          requestedContracts: order.requestedContracts,
          filledContracts: order.filledContracts,
          limitPrice: order.limitPrice,
          entryPrice: order.simulatedAvgFillPrice,
          cost,
          modelProbability: candidate?.yesProbability ?? order.signal.modelProbability,
          impliedProbability: candidate?.impliedProbability ?? order.signal.impliedProbability,
          edge: candidate?.edge ?? order.signal.edge,
          forecastValue: candidate?.forecastValue ?? null,
          threshold: candidate?.threshold ?? null,
          thresholdOperator: candidate?.thresholdOperator ?? null,
          targetDate: candidate?.targetDate ?? null,
          variable: candidate?.variable ?? null,
          status,
          settlementResult: settlement?.result ?? null,
          settledAt: settlement?.createdAt ?? null,
          payout,
          pnl,
          roi,
          features: toJson({
            candidate,
            signal: {
              id: order.signal.id,
              modelProbability: order.signal.modelProbability,
              impliedProbability: order.signal.impliedProbability,
              edge: order.signal.edge,
              explanation: order.signal.explanation,
              skipReason: order.signal.skipReason
            },
            orderReason: order.reason
          })
        },
        update: {
          filledContracts: order.filledContracts,
          entryPrice: order.simulatedAvgFillPrice,
          cost,
          modelProbability: candidate?.yesProbability ?? order.signal.modelProbability,
          impliedProbability: candidate?.impliedProbability ?? order.signal.impliedProbability,
          edge: candidate?.edge ?? order.signal.edge,
          forecastValue: candidate?.forecastValue ?? null,
          threshold: candidate?.threshold ?? null,
          thresholdOperator: candidate?.thresholdOperator ?? null,
          targetDate: candidate?.targetDate ?? null,
          variable: candidate?.variable ?? null,
          status,
          settlementResult: settlement?.result ?? null,
          settledAt: settlement?.createdAt ?? null,
          payout,
          pnl,
          roi,
          features: toJson({
            candidate,
            signal: {
              id: order.signal.id,
              modelProbability: order.signal.modelProbability,
              impliedProbability: order.signal.impliedProbability,
              edge: order.signal.edge,
              explanation: order.signal.explanation,
              skipReason: order.signal.skipReason
            },
            orderReason: order.reason
          })
        }
      });
    }
  }

  private async rebuildPaperPositions() {
    const [orders, settlements] = await Promise.all([
      this.prisma.paperOrder.findMany({ orderBy: { timestamp: "asc" } }),
      this.prisma.settlement.findMany()
    ]);
    const positions = buildPaperPositionsFromOrders(orders.map(fromPrismaPaperOrder), settlements.map(fromPrismaSettlement));
    for (const position of positions) {
      await this.prisma.paperPosition.upsert({
        where: { marketTicker_side: { marketTicker: position.marketTicker, side: position.side } },
        create: {
          id: position.id ?? `paper_position_${position.marketTicker}_${position.side}`,
          marketTicker: position.marketTicker,
          side: position.side,
          contracts: position.contracts,
          avgEntryPrice: position.avgEntryPrice,
          markPrice: position.markPrice,
          realizedPnl: position.realizedPnl,
          openedAt: new Date(position.openedAt ?? new Date().toISOString()),
          closedAt: position.closedAt ? new Date(position.closedAt) : null,
          settlementId: position.settlementId ?? null
        },
        update: {
          contracts: position.contracts,
          avgEntryPrice: position.avgEntryPrice,
          markPrice: position.markPrice,
          realizedPnl: position.realizedPnl,
          closedAt: position.closedAt ? new Date(position.closedAt) : null,
          settlementId: position.settlementId ?? null
        }
      });
      await this.prisma.paperOrder.updateMany({
        where: { marketTicker: position.marketTicker, side: position.side, filledContracts: { gt: 0 } },
        data: { positionId: position.id ?? `paper_position_${position.marketTicker}_${position.side}` } as never
      });
    }
  }

  private async persistScanReport(report: ScanReport) {
    await this.prisma.scanReport.upsert({
      where: { id: report.id },
      create: scanReportWrite(report),
      update: scanReportWrite(report)
    });
  }

  private async backtestStoredWouldBuys(options: BacktestOptions = defaultBacktestOptions()) {
    const observedAt: Prisma.DateTimeFilter<"CandidateDecisionSnapshot"> = {};
    if (options.startDate) observedAt.gte = new Date(`${options.startDate}T00:00:00Z`);
    if (options.endDate) observedAt.lte = new Date(`${options.endDate}T23:59:59.999Z`);
    const [snapshots, settlements] = await Promise.all([
      this.prisma.candidateDecisionSnapshot.findMany({
        where: {
          status: options.status,
          entryPrice: { not: null },
          ...(options.startDate || options.endDate ? { observedAt } : {})
        },
        orderBy: { observedAt: "asc" },
        take: 10000
      }),
      this.prisma.settlement.findMany()
    ]);
    const settlementByTicker = new Map(settlements.map((settlement) => [settlement.marketTicker, settlement]));
    const seenMarkets = new Set<string>();
    const trades: BacktestTrade[] = [];
    const filteredSnapshots = snapshots.filter((snapshot) => {
      if (snapshot.entryPrice === null) return false;
      if (options.minEdge !== null && (snapshot.edge === null || snapshot.edge < options.minEdge)) return false;
      if (options.maxEntryPrice !== null && snapshot.entryPrice > options.maxEntryPrice) return false;
      if (options.minLiquidityScore !== null && snapshot.liquidityScore < options.minLiquidityScore) return false;
      if (options.maxSpread !== null && (snapshot.spread === null || snapshot.spread > options.maxSpread)) return false;
      return true;
    });

    const orderedSnapshots = options.selection === "best_edge"
      ? [...filteredSnapshots].sort((a, b) => {
          const edgeDiff = (b.edge ?? -Infinity) - (a.edge ?? -Infinity);
          return edgeDiff !== 0 ? edgeDiff : a.observedAt.getTime() - b.observedAt.getTime();
        })
      : filteredSnapshots;
    const marketTickers = [...new Set(orderedSnapshots.map((snapshot) => snapshot.marketTicker))];
    const [candlesticks, marketTrades] = await Promise.all([
      this.prisma.kalshiMarketCandlestick.findMany({
        where: { marketTicker: { in: marketTickers } },
        orderBy: [{ marketTicker: "asc" }, { endPeriodAt: "asc" }]
      }),
      this.prisma.kalshiMarketTrade.findMany({
        where: { marketTicker: { in: marketTickers } },
        orderBy: [{ marketTicker: "asc" }, { createdTime: "asc" }]
      })
    ]);
    const candlesByTicker = groupBy(candlesticks, (candle) => candle.marketTicker);
    const tradesByTicker = groupBy(marketTrades, (trade) => trade.marketTicker);

    for (const snapshot of orderedSnapshots) {
      if (options.selection !== "each_signal" && seenMarkets.has(snapshot.marketTicker)) continue;
      const settlement = settlementByTicker.get(snapshot.marketTicker);
      if (!settlement || snapshot.entryPrice === null) continue;
      seenMarkets.add(snapshot.marketTicker);
      const replay = replayMarketPrices(
        snapshot,
        candlesByTicker.get(snapshot.marketTicker) ?? [],
        tradesByTicker.get(snapshot.marketTicker) ?? []
      );
      const rawEntryPrice = replay.entryPrice ?? snapshot.entryPrice;
      const entryPrice = applyHistoricalExecution(rawEntryPrice, options);
      const contracts = simulatedContractsForBacktest(entryPrice, options);
      const cost = Number((entryPrice * contracts).toFixed(4));
      const payout = settlement.result === "yes" ? contracts : 0;
      const pnl = Number((payout - cost).toFixed(4));
      const targetDate = snapshot.targetDate?.toISOString().slice(0, 10) ?? null;
      trades.push({
        marketTicker: snapshot.marketTicker,
        observedAt: snapshot.observedAt.toISOString(),
        status: snapshot.status,
        city: snapshot.city,
        variable: snapshot.variable,
        targetDate,
        eventKey: eventKeyForMarket(snapshot.marketTicker, targetDate),
        entryPrice,
        rawEntryPrice,
        entrySource: replay.entrySource,
        slippageCents: options.slippageCents,
        contracts,
        cost,
        payout,
        pnl,
        roi: cost > 0 ? Number((pnl / cost).toFixed(4)) : 0,
        edge: snapshot.edge,
        modelProbability: snapshot.yesProbability,
        impliedProbability: snapshot.impliedProbability,
        spread: snapshot.spread,
        liquidityScore: snapshot.liquidityScore,
        settlementResult: settlement.result,
        priceBefore: replay.priceBefore,
        priceAfter: replay.priceAfter,
        maxPriceAfter: replay.maxPriceAfter,
        minPriceAfter: replay.minPriceAfter,
        impliedProbabilityMove: replay.priceAfter !== null ? Number((replay.priceAfter - entryPrice).toFixed(4)) : null
      });
    }

    const simulatedTrades = trades.length;
    const wins = trades.filter((trade) => trade.pnl >= 0).length;
    const losses = trades.filter((trade) => trade.pnl < 0).length;
    const totalCost = trades.reduce((sum, trade) => sum + trade.cost, 0);
    const totalPayout = trades.reduce((sum, trade) => sum + trade.payout, 0);
    const totalPnl = totalPayout - totalCost;
    const sortedTrades = [...trades].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const equityCurve = buildEquityCurve(sortedTrades);
    const averageEdge = average(sortedTrades.map((trade) => trade.edge));
    const averageEntryPrice = average(sortedTrades.map((trade) => trade.entryPrice));
    const averageLiquidityScore = average(sortedTrades.map((trade) => trade.liquidityScore));
    const winningPnl = sortedTrades.filter((trade) => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
    const losingPnl = Math.abs(sortedTrades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));
    const thresholds = defaultStrategyApprovalThresholds;
    const expectancy = calculateExpectancyMetrics(sortedTrades, thresholds);
    const dataQuality = scoreBacktestDataQuality({
      trades: sortedTrades,
      snapshots,
      filteredSnapshots,
      orderedSnapshots,
      settlements,
      marketTickers,
      candlesticks,
      marketTrades,
      thresholds
    });
    const overfitting = detectAntiOverfitting({
      trades: sortedTrades,
      candidateSnapshots: snapshots.length,
      eligibleSnapshots: filteredSnapshots.length,
      parameters: options,
      thresholds
    });
    const paperValidation = await this.paperValidationFor(expectancy);
    const approval = evaluateStrategyApproval({
      validationMode: options.validationMode,
      thresholds,
      metrics: expectancy,
      dataQuality,
      overfitting,
      paperValidation
    });
    return {
      method: backtestMethodLabel(options),
      parameters: options,
      candidateSnapshots: snapshots.length,
      eligibleSnapshots: filteredSnapshots.length,
      evaluatedMarkets: simulatedTrades,
      wins,
      losses,
      winRate: simulatedTrades > 0 ? Number((wins / simulatedTrades).toFixed(4)) : 0,
      totalCost: Number(totalCost.toFixed(4)),
      totalPayout: Number(totalPayout.toFixed(4)),
      totalPnl: Number(totalPnl.toFixed(4)),
      roi: totalCost > 0 ? Number((totalPnl / totalCost).toFixed(4)) : 0,
      averageEntryPrice: roundMetric(averageEntryPrice),
      averageEdge: roundMetric(averageEdge),
      averageLiquidityScore: roundMetric(averageLiquidityScore),
      profitFactor: losingPnl > 0 ? roundMetric(winningPnl / losingPnl) : winningPnl > 0 ? null : 0,
      maxDrawdown: equityCurve.maxDrawdown,
      equityCurve: equityCurve.points,
      longestLosingStreak: longestLosingStreak(sortedTrades),
      expectancy,
      dataQuality,
      overfitting,
      paperValidation,
      approval,
      thresholds,
      trades: sortedTrades.slice(-50).reverse()
    };
  }
}

type BacktestSelection = "first_signal" | "best_edge" | "each_signal";

type BacktestOptions = {
  strategyKey: string;
  validationMode: StrategyValidationMode;
  status: string;
  selection: BacktestSelection;
  minEdge: number | null;
  maxEntryPrice: number | null;
  minLiquidityScore: number | null;
  maxSpread: number | null;
  stakePerTrade: number;
  maxContracts: number;
  slippageCents: number;
  startDate: string | null;
  endDate: string | null;
  paperTradingStartDate: string | null;
  notes: string | null;
};

type BacktestTrade = StrategyTradeResult & {
  status: string;
  entrySource: string;
  slippageCents: number;
  edge: number | null;
  modelProbability: number | null;
  impliedProbability: number | null;
  spread: number | null;
  settlementResult: string;
  priceBefore: number | null;
  priceAfter: number | null;
  maxPriceAfter: number | null;
  minPriceAfter: number | null;
  impliedProbabilityMove: number | null;
};

function defaultBacktestOptions(): BacktestOptions {
  return {
    strategyKey: "candidate_snapshot_v2",
    validationMode: "backtest",
    status: "WOULD_BUY",
    selection: "first_signal",
    minEdge: null,
    maxEntryPrice: null,
    minLiquidityScore: null,
    maxSpread: null,
    stakePerTrade: env.MAX_STAKE_PER_TRADE_PAPER,
    maxContracts: activeRiskLimits.maxContractsPerTrade,
    slippageCents: 1,
    startDate: null,
    endDate: null,
    paperTradingStartDate: null,
    notes: null
  };
}

function parseBacktestParameters(parameters: Record<string, unknown>): BacktestOptions {
  const defaults = defaultBacktestOptions();
  const selection = stringParam(parameters.selection);
  const validationMode = stringParam(parameters.validationMode);
  return {
    strategyKey: stringParam(parameters.strategyKey) ?? defaults.strategyKey,
    validationMode: validationMode === "walk_forward" || validationMode === "paper" || validationMode === "backtest" ? validationMode : defaults.validationMode,
    status: stringParam(parameters.status) ?? defaults.status,
    selection: selection === "best_edge" || selection === "each_signal" || selection === "first_signal" ? selection : defaults.selection,
    minEdge: nullableNumber(parameters.minEdge, 0, 1),
    maxEntryPrice: nullableNumber(parameters.maxEntryPrice, 0.01, 1),
    minLiquidityScore: nullableNumber(parameters.minLiquidityScore, 0, 1),
    maxSpread: nullableNumber(parameters.maxSpread, 0, 1),
    stakePerTrade: numberParam(parameters.stakePerTrade, 1, 1000) ?? defaults.stakePerTrade,
    maxContracts: Math.floor(numberParam(parameters.maxContracts, 1, 1000) ?? defaults.maxContracts),
    slippageCents: numberParam(parameters.slippageCents, 0, 25) ?? defaults.slippageCents,
    startDate: dateParam(parameters.startDate),
    endDate: dateParam(parameters.endDate),
    paperTradingStartDate: dateParam(parameters.paperTradingStartDate),
    notes: stringParam(parameters.notes)
  };
}

function stringParam(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberParam(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function nullableNumber(value: unknown, min: number, max: number) {
  return numberParam(value, min, max);
}

function dateParam(value: unknown) {
  const text = stringParam(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function simulatedContractsForBacktest(entryPrice: number, options: BacktestOptions) {
  return Math.max(1, Math.min(options.maxContracts, Math.floor(options.stakePerTrade / Math.max(entryPrice, 0.01))));
}

function applyHistoricalExecution(entryPrice: number, options: BacktestOptions) {
  return Number(Math.min(0.99, entryPrice + options.slippageCents / 100).toFixed(4));
}

function backtestMethodLabel(options: BacktestOptions) {
  if (options.selection === "best_edge") return "best edge candidate per settled market";
  if (options.selection === "each_signal") return "every eligible settled candidate snapshot";
  return "first eligible candidate per settled market";
}

function buildEquityCurve(trades: BacktestTrade[]) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const points = trades.map((trade) => {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    return { observedAt: trade.observedAt, equity: Number(equity.toFixed(4)), pnl: trade.pnl };
  });
  return { points, maxDrawdown: Number(maxDrawdown.toFixed(4)) };
}

function longestLosingStreak(trades: BacktestTrade[]) {
  let current = 0;
  let longest = 0;
  for (const trade of trades) {
    if (trade.pnl < 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function average(values: Array<number | null>) {
  const realValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return realValues.length > 0 ? realValues.reduce((sum, value) => sum + value, 0) / realValues.length : null;
}

function roundMetric(value: number | null) {
  return value === null ? null : Number(value.toFixed(4));
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

type ReplaySnapshot = {
  marketTicker: string;
  observedAt: Date;
  entryPrice: number | null;
};

type ReplayCandle = {
  endPeriodAt: Date;
  yesAskClose: number | null;
  yesBidClose: number | null;
  priceClose: number | null;
  pricePrevious: number | null;
};

type ReplayTrade = {
  createdTime: Date;
  yesPrice: number | null;
};

function replayMarketPrices(snapshot: ReplaySnapshot, candles: ReplayCandle[], trades: ReplayTrade[]) {
  const observedAt = snapshot.observedAt.getTime();
  const beforeCandles = candles.filter((candle) => candle.endPeriodAt.getTime() <= observedAt);
  const afterCandles = candles.filter((candle) => candle.endPeriodAt.getTime() >= observedAt);
  const entryCandle = afterCandles[0] ?? beforeCandles.at(-1) ?? null;
  const beforeCandle = beforeCandles.at(-1) ?? null;
  const candleEntry = candleEntryPrice(entryCandle);
  if (candleEntry !== null) {
    const futurePrices = afterCandles.flatMap((candle) => {
      const value = candleEntryPrice(candle);
      return value === null ? [] : [value];
    });
    const priceAfter = futurePrices.at(-1) ?? null;
    return {
      entryPrice: candleEntry,
      entrySource: "candlestick",
      priceBefore: candleEntryPrice(beforeCandle),
      priceAfter,
      maxPriceAfter: futurePrices.length > 0 ? Math.max(...futurePrices) : null,
      minPriceAfter: futurePrices.length > 0 ? Math.min(...futurePrices) : null
    };
  }

  const beforeTrades = trades.filter((trade) => trade.createdTime.getTime() <= observedAt && trade.yesPrice !== null);
  const afterTrades = trades.filter((trade) => trade.createdTime.getTime() >= observedAt && trade.yesPrice !== null);
  const entryTrade = afterTrades[0] ?? beforeTrades.at(-1) ?? null;
  const tradeEntry = entryTrade?.yesPrice ?? null;
  if (tradeEntry !== null) {
    const futurePrices = afterTrades.flatMap((trade) => trade.yesPrice === null ? [] : [trade.yesPrice]);
    return {
      entryPrice: tradeEntry,
      entrySource: "trade",
      priceBefore: beforeTrades.at(-1)?.yesPrice ?? null,
      priceAfter: futurePrices.at(-1) ?? null,
      maxPriceAfter: futurePrices.length > 0 ? Math.max(...futurePrices) : null,
      minPriceAfter: futurePrices.length > 0 ? Math.min(...futurePrices) : null
    };
  }

  return {
    entryPrice: snapshot.entryPrice,
    entrySource: "candidate_snapshot",
    priceBefore: null,
    priceAfter: null,
    maxPriceAfter: null,
    minPriceAfter: null
  };
}

function candleEntryPrice(candle: ReplayCandle | null) {
  return candle?.yesAskClose ?? candle?.priceClose ?? candle?.yesBidClose ?? candle?.pricePrevious ?? null;
}

function scoreBacktestDataQuality(input: {
  trades: BacktestTrade[];
  snapshots: Array<{ marketTicker: string; forecastValue: number | null; entryPrice: number | null }>;
  filteredSnapshots: Array<{ marketTicker: string; entryPrice: number | null; liquidityScore: number }>;
  orderedSnapshots: Array<{ marketTicker: string }>;
  settlements: Array<{ marketTicker: string }>;
  marketTickers: string[];
  candlesticks: Array<{ marketTicker: string; endPeriodAt: Date; yesAskClose: number | null; yesBidClose: number | null; priceClose: number | null; pricePrevious: number | null }>;
  marketTrades: Array<{ marketTicker: string; createdTime: Date; yesPrice: number | null }>;
  thresholds: typeof defaultStrategyApprovalThresholds;
}) {
  const settlementTickers = new Set(input.settlements.map((settlement) => settlement.marketTicker));
  const historyTickers = new Set([...input.candlesticks.map((candle) => candle.marketTicker), ...input.marketTrades.map((trade) => trade.marketTicker)]);
  const missingMarketPrices = input.trades.filter((trade) => trade.entrySource === "candidate_snapshot").length + input.filteredSnapshots.filter((snapshot) => snapshot.entryPrice === null).length;
  const missingForecastSnapshots = input.filteredSnapshots.filter((snapshot) => snapshot.entryPrice !== null && !input.snapshots.some((candidate) => candidate.marketTicker === snapshot.marketTicker && candidate.forecastValue !== null)).length;
  const settlementAmbiguities = input.orderedSnapshots.filter((snapshot) => !settlementTickers.has(snapshot.marketTicker)).length;
  const lowLiquidityMarkets = input.trades.filter((trade) => (trade.liquidityScore ?? 0) < input.thresholds.minLiquidityScore).length;
  const suspiciousPriceGaps = input.trades.filter((trade) => {
    if (trade.maxPriceAfter === null || trade.minPriceAfter === null) return false;
    return trade.maxPriceAfter - trade.minPriceAfter > 0.7;
  }).length;
  const incompleteMarketHistories = input.marketTickers.filter((ticker) => !historyTickers.has(ticker)).length;

  return scoreDataQuality({
    totalMarkets: Math.max(input.marketTickers.length, input.filteredSnapshots.length, input.trades.length),
    missingMarketPrices,
    missingForecastSnapshots,
    staleForecasts: 0,
    settlementAmbiguities,
    lowLiquidityMarkets,
    suspiciousPriceGaps,
    duplicateMarketRows: duplicateHistoricalRows(input.candlesticks, input.marketTrades),
    incompleteMarketHistories,
    latestMarketDataAt: latestIso([
      ...input.candlesticks.map((candle) => candle.endPeriodAt),
      ...input.marketTrades.map((trade) => trade.createdTime)
    ]),
    latestForecastAt: latestIso(input.trades.map((trade) => new Date(trade.observedAt)))
  });
}

function duplicateHistoricalRows(
  candlesticks: Array<{ marketTicker: string; endPeriodAt: Date }>,
  trades: Array<{ marketTicker: string; createdTime: Date; yesPrice: number | null }>
) {
  const seenCandles = new Set<string>();
  const seenTrades = new Set<string>();
  let duplicates = 0;
  for (const candle of candlesticks) {
    const key = `${candle.marketTicker}:${candle.endPeriodAt.toISOString()}`;
    if (seenCandles.has(key)) duplicates += 1;
    seenCandles.add(key);
  }
  for (const trade of trades) {
    const key = `${trade.marketTicker}:${trade.createdTime.toISOString()}:${trade.yesPrice ?? "null"}`;
    if (seenTrades.has(key)) duplicates += 1;
    seenTrades.add(key);
  }
  return duplicates;
}

function latestIso(dates: Date[]) {
  const timestamps = dates.map((date) => date.getTime()).filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function eventKeyForMarket(marketTicker: string, targetDate: string | null) {
  const parts = marketTicker.split("-");
  const eventTicker = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : marketTicker;
  return targetDate ? `${eventTicker}:${targetDate}` : eventTicker;
}

function strategyConfigHash(options: BacktestOptions) {
  return createHash("sha256").update(JSON.stringify(stableJson(options))).digest("hex");
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableJson(item)]));
}

function codeVersion() {
  return process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? null;
}

function expectedPaperPnl(example: {
  modelProbability: number | null;
  entryPrice: number | null;
  limitPrice: number;
  filledContracts: number;
}) {
  const probability = example.modelProbability;
  if (probability === null || example.filledContracts <= 0) return null;
  const entry = example.entryPrice ?? example.limitPrice;
  const winPnl = (1 - entry) * example.filledContracts;
  const lossPnl = -entry * example.filledContracts;
  return Number((probability * winPnl + (1 - probability) * lossPnl).toFixed(4));
}

function paperValidationStatus(status: string): PaperValidationTrade["status"] {
  if (status === "won") return "won";
  if (status === "lost") return "lost";
  if (status === "rejected") return "rejected";
  if (status === "open") return "open";
  return "skipped";
}

function latestVersionsByStrategy<T extends { strategyKey: string; createdAt: Date }>(versions: T[]) {
  const byStrategy = new Map<string, T>();
  for (const version of versions) {
    if (!byStrategy.has(version.strategyKey)) byStrategy.set(version.strategyKey, version);
  }
  return [...byStrategy.values()];
}

function strategyVersionDashboardRow(version: {
  id: string;
  strategyKey: string;
  configHash: string;
  codeVersion: string | null;
  dataSourceVersion: string;
  backtestDate: Date | null;
  validationDate: Date | null;
  paperTradingStartDate: Date | null;
  notes: string | null;
  approvalStatus: string;
  createdAt: Date;
  runs: Array<{ id: string; summary: Prisma.JsonValue | null; startedAt: Date; completedAt: Date | null }>;
}) {
  const latestRun = version.runs[0] ?? null;
  const summary = jsonRecord(latestRun?.summary);
  const approval = jsonRecord(summary?.approval);
  const explanation = jsonRecord(approval?.explanation);
  return {
    id: version.id,
    strategyKey: version.strategyKey,
    configHash: version.configHash.slice(0, 12),
    codeVersion: version.codeVersion,
    dataSourceVersion: version.dataSourceVersion,
    approvalStatus: version.approvalStatus,
    backtestDate: version.backtestDate?.toISOString() ?? null,
    validationDate: version.validationDate?.toISOString() ?? null,
    paperTradingStartDate: version.paperTradingStartDate?.toISOString() ?? null,
    notes: version.notes,
    latestRunId: latestRun?.id ?? null,
    latestRunAt: latestRun?.startedAt.toISOString() ?? null,
    evaluatedMarkets: numberField(summary, "evaluatedMarkets"),
    roi: numberField(summary, "roi"),
    totalPnl: numberField(summary, "totalPnl"),
    summary: typeof explanation?.summary === "string" ? explanation.summary : null
  };
}

function strategyRunWarnings(run: {
  id: string;
  approvalStatus: string;
  warnings: Prisma.JsonValue | null;
  summary: Prisma.JsonValue | null;
  startedAt: Date;
}) {
  const rows: Array<{ runId: string; approvalStatus: string; severity: string; message: string; code: string; startedAt: string }> = [];
  const warnings = jsonArray(run.warnings);
  for (const warning of warnings) {
    const record = jsonRecord(warning);
    const severity = typeof record?.severity === "string" ? record.severity : "warning";
    if (severity === "info") continue;
    rows.push({
      runId: run.id,
      approvalStatus: run.approvalStatus,
      severity,
      message: typeof record?.message === "string" ? record.message : "Strategy warning requires review.",
      code: typeof record?.code === "string" ? record.code : "strategy_warning",
      startedAt: run.startedAt.toISOString()
    });
  }
  const summary = jsonRecord(run.summary);
  const approval = jsonRecord(summary?.approval);
  const gates = jsonArray(approval?.gates);
  for (const gateValue of gates) {
    const gateRecord = jsonRecord(gateValue);
    if (!gateRecord || gateRecord.passed !== false) continue;
    rows.push({
      runId: run.id,
      approvalStatus: run.approvalStatus,
      severity: "critical",
      message: typeof gateRecord.reason === "string" ? gateRecord.reason : "Approval gate failed.",
      code: typeof gateRecord.name === "string" ? gateRecord.name : "approval_gate_failed",
      startedAt: run.startedAt.toISOString()
    });
  }
  return rows;
}

function paperHealthFromSummary(summary: Record<string, unknown> | null) {
  const paperValidation = jsonRecord(summary?.paperValidation);
  if (!paperValidation) return null;
  return {
    paperTrades: numberField(paperValidation, "paperTrades"),
    settledPaperTrades: numberField(paperValidation, "settledPaperTrades"),
    expectedWinRate: numberField(paperValidation, "expectedWinRate"),
    observedWinRate: numberField(paperValidation, "observedWinRate"),
    expectedPnlPerTrade: numberField(paperValidation, "expectedPnlPerTrade"),
    observedPnlPerTrade: numberField(paperValidation, "observedPnlPerTrade"),
    liveEdgeDegraded: Boolean(paperValidation.liveEdgeDegraded)
  };
}

function buildOptimizerPlan(parameters: Record<string, unknown>) {
  const baseMinEdge = env.MIN_EDGE_PERCENTAGE_POINTS / 100;
  const maxRuns = Math.floor(numberParam(parameters.maxRuns, 1, 30) ?? env.STRATEGY_OPTIMIZER_MAX_RUNS);
  const validationMode = optimizerValidationMode(parameters.validationMode);
  const minEdges = optimizerNumberGrid(parameters.minEdgeGrid, env.STRATEGY_OPTIMIZER_MIN_EDGE_GRID, [
    Math.max(0, baseMinEdge - 0.02),
    baseMinEdge,
    Math.min(0.2, baseMinEdge + 0.02),
    Math.min(0.25, baseMinEdge + 0.04)
  ], 0, 1);
  const minLiquidityScores = optimizerNumberGrid(parameters.minLiquidityGrid, env.STRATEGY_OPTIMIZER_MIN_LIQUIDITY_GRID, [
    activeRiskLimits.minLiquidityScore,
    0.05,
    0.1,
    0.2
  ], 0, 1);
  const maxSpreads = optimizerNumberGrid(parameters.maxSpreadGrid, env.STRATEGY_OPTIMIZER_MAX_SPREAD_GRID, [
    Math.max(0.02, activeRiskLimits.maxSpread * 0.75),
    activeRiskLimits.maxSpread,
    Math.min(0.25, activeRiskLimits.maxSpread * 1.25)
  ], 0, 1);
  const slippageCents = optimizerNumberGrid(parameters.slippageCentsGrid, env.STRATEGY_OPTIMIZER_SLIPPAGE_CENTS_GRID, [1, 2, 3], 0, 25).map((value) => Math.round(value));
  const selections = optimizerSelectionGrid(parameters.selectionGrid, env.STRATEGY_OPTIMIZER_SELECTION_GRID);
  const strategyKey = stringParam(parameters.strategyKey) ?? "candidate_snapshot_v2_optimizer";
  const trigger = stringParam(parameters.trigger) ?? "manual_optimizer";
  const startDate = dateParam(parameters.startDate);
  const endDate = dateParam(parameters.endDate);

  const candidates = [];
  let index = 0;
  for (const selection of selections) {
    for (const minEdge of minEdges) {
      for (const minLiquidityScore of minLiquidityScores) {
        for (const maxSpread of maxSpreads) {
          for (const slippage of slippageCents) {
            candidates.push({
              optimizerCandidateId: `candidate_${String(index + 1).padStart(2, "0")}`,
              selection,
              status: "WOULD_BUY",
              minEdge,
              maxEntryPrice: null,
              minLiquidityScore,
              maxSpread,
              stakePerTrade: env.MAX_STAKE_PER_TRADE_PAPER,
              maxContracts: activeRiskLimits.maxContractsPerTrade,
              slippageCents: slippage,
              startDate,
              endDate
            });
            index += 1;
            if (candidates.length >= maxRuns) {
              return {
                strategyKey,
                trigger,
                validationMode,
                searchSpace: { maxRuns, minEdges, minLiquidityScores, maxSpreads, slippageCents, selections, startDate, endDate },
                candidates
              };
            }
          }
        }
      }
    }
  }

  return {
    strategyKey,
    trigger,
    validationMode,
    searchSpace: { maxRuns, minEdges, minLiquidityScores, maxSpreads, slippageCents, selections, startDate, endDate },
    candidates
  };
}

function optimizerResultFromRun(
  result: { id: string; strategyVersionId?: string; summary: unknown },
  candidate: ReturnType<typeof buildOptimizerPlan>["candidates"][number]
) {
  const summary = jsonRecord(result.summary);
  const approval = jsonRecord(summary?.approval);
  const dataQuality = jsonRecord(summary?.dataQuality);
  const expectancy = jsonRecord(summary?.expectancy);
  const warnings = jsonArray(approval?.warnings);
  const approvalStatus = typeof approval?.status === "string" ? approval.status : "Draft";
  const roi = numberField(summary, "roi") ?? 0;
  const totalPnl = numberField(summary, "totalPnl") ?? 0;
  const evaluatedMarkets = numberField(summary, "evaluatedMarkets") ?? 0;
  const dataQualityScore = numberField(dataQuality, "score") ?? 0;
  const expectedValuePerTrade = numberField(expectancy, "expectedValuePerTrade") ?? 0;
  const riskOfRuin = numberField(expectancy, "riskOfRuin") ?? 1;
  const maxDrawdown = numberField(summary, "maxDrawdown") ?? 0;
  const score = optimizerScore({ approvalStatus, roi, totalPnl, evaluatedMarkets, dataQualityScore, expectedValuePerTrade, riskOfRuin, maxDrawdown, warnings: warnings.length });
  return {
    optimizerCandidateId: candidate.optimizerCandidateId,
    runId: result.id,
    strategyVersionId: result.strategyVersionId ?? null,
    approvalStatus,
    score,
    evaluatedMarkets,
    roi,
    totalPnl,
    dataQualityScore,
    expectedValuePerTrade,
    riskOfRuin,
    maxDrawdown,
    warnings: warnings.length,
    parameters: candidate
  };
}

function optimizerScore(input: {
  approvalStatus: string;
  roi: number;
  totalPnl: number;
  evaluatedMarkets: number;
  dataQualityScore: number;
  expectedValuePerTrade: number;
  riskOfRuin: number;
  maxDrawdown: number;
  warnings: number;
}) {
  const statusScore = input.approvalStatus === "Paper Approved"
    ? 1000
    : input.approvalStatus === "Walk-Forward Passed"
      ? 800
      : input.approvalStatus === "Backtest Passed"
        ? 600
        : input.approvalStatus === "Paper Testing"
          ? 500
          : input.approvalStatus === "Rejected"
            ? -1000
            : 0;
  return Number((
    statusScore +
    input.roi * 100 +
    input.expectedValuePerTrade * 25 +
    Math.min(100, input.evaluatedMarkets) +
    input.dataQualityScore -
    input.riskOfRuin * 100 -
    input.maxDrawdown -
    input.warnings * 25 +
    Math.min(100, input.totalPnl)
  ).toFixed(4));
}

function optimizerRecommendation(
  champion: { approvalStatus: string; roi: number | null; summary: string | null; strategyKey: string; configHash: string } | null,
  bestCandidate: ReturnType<typeof optimizerResultFromRun> | null
) {
  if (!bestCandidate) return "No optimizer candidates were evaluated.";
  if (bestCandidate.approvalStatus === "Rejected") {
    return `No challenger passed approval gates; best rejected candidate was ${bestCandidate.optimizerCandidateId}.`;
  }
  const championRoi = champion?.roi ?? null;
  const roiDelta = championRoi === null ? null : bestCandidate.roi - championRoi;
  if (!champion) {
    return `${bestCandidate.optimizerCandidateId} is the current best candidate and should enter paper review.`;
  }
  if (roiDelta !== null && roiDelta > 0.02 && bestCandidate.score > 0) {
    return `${bestCandidate.optimizerCandidateId} beat the current champion by ${(roiDelta * 100).toFixed(1)} ROI points; review it as a challenger before changing code.`;
  }
  return `${bestCandidate.optimizerCandidateId} passed gates but did not clearly beat the current champion; keep collecting paper data.`;
}

function optimizerValidationMode(value: unknown): "backtest" | "walk_forward" | "paper" {
  const text = stringParam(value);
  return text === "backtest" || text === "paper" || text === "walk_forward" ? text : "walk_forward";
}

function optimizerNumberGrid(value: unknown, envValue: string, fallback: number[], min: number, max: number) {
  const raw = Array.isArray(value) ? value.join(",") : typeof value === "string" && value.trim() ? value : envValue;
  const parsed = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item))
    .map((item) => Number(Math.min(max, Math.max(min, item)).toFixed(4)));
  const source = parsed.length > 0 ? parsed : fallback;
  return [...new Set(source.map((item) => Number(Math.min(max, Math.max(min, item)).toFixed(4))))].sort((a, b) => a - b);
}

function optimizerSelectionGrid(value: unknown, envValue: string): Array<"first_signal" | "best_edge" | "each_signal"> {
  const raw = Array.isArray(value) ? value.join(",") : typeof value === "string" && value.trim() ? value : envValue;
  const allowed = new Set(["first_signal", "best_edge", "each_signal"]);
  const parsed = raw.split(",").map((item) => item.trim()).filter((item): item is "first_signal" | "best_edge" | "each_signal" => allowed.has(item));
  return parsed.length > 0 ? [...new Set(parsed)] : ["first_signal", "best_edge"];
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function marketWrite(market: KalshiMarketCandidate) {
  return {
    ticker: market.ticker,
    eventTicker: market.eventTicker,
    title: market.title,
    subtitle: market.subtitle ?? null,
    closeTime: optionalDate(market.closeTime),
    settlementTime: optionalDate(market.settlementTime),
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    noBid: market.noBid,
    noAsk: market.noAsk,
    lastPrice: market.lastPrice,
    volume: market.volume,
    openInterest: market.openInterest,
    liquidityScore: 0,
    rawPayload: toJson(market.rawPayload)
  };
}

function historicalMarketWrite(market: KalshiHistoricalMarket) {
  return {
    ticker: market.ticker,
    eventTicker: market.eventTicker,
    title: market.title,
    subtitle: market.subtitle ?? null,
    status: market.status,
    result: market.result,
    closeTime: optionalDate(market.closeTime),
    settlementTime: optionalDate(market.settlementTime),
    settlementTs: optionalDate(market.settlementTs ?? undefined),
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    noBid: market.noBid,
    noAsk: market.noAsk,
    lastPrice: market.lastPrice,
    volume: market.volume,
    openInterest: market.openInterest,
    settlementValue: market.settlementValue,
    rawPayload: toJson(market.rawPayload)
  };
}

function candlestickWrite(candle: KalshiCandlestick, source: string, periodInterval: number) {
  return {
    id: `candle_${source}_${periodInterval}_${candle.marketTicker}_${candle.endPeriodTs}`,
    marketTicker: candle.marketTicker,
    source,
    periodInterval,
    endPeriodTs: BigInt(candle.endPeriodTs),
    endPeriodAt: new Date(candle.endPeriodAt),
    yesBidOpen: candle.yesBid.open,
    yesBidLow: candle.yesBid.low,
    yesBidHigh: candle.yesBid.high,
    yesBidClose: candle.yesBid.close,
    yesAskOpen: candle.yesAsk.open,
    yesAskLow: candle.yesAsk.low,
    yesAskHigh: candle.yesAsk.high,
    yesAskClose: candle.yesAsk.close,
    priceOpen: candle.price.open,
    priceLow: candle.price.low,
    priceHigh: candle.price.high,
    priceClose: candle.price.close,
    priceMean: candle.price.mean,
    pricePrevious: candle.price.previous,
    volume: candle.volume,
    openInterest: candle.openInterest,
    rawPayload: toJson(candle.rawPayload)
  };
}

function tradeWrite(trade: KalshiTradePrint, source: string) {
  return {
    id: trade.id,
    marketTicker: trade.marketTicker,
    source,
    count: trade.count,
    yesPrice: trade.yesPrice,
    noPrice: trade.noPrice,
    takerSide: trade.takerSide,
    createdTime: new Date(trade.createdTime),
    rawPayload: toJson(trade.rawPayload)
  };
}

async function* streamTable<T>(table: string, fetchPage: (skip: number, take: number) => Promise<T[]>) {
  yield ndjsonLine({ type: "table_start", table });
  const batchSize = 500;
  for (let skip = 0; ; skip += batchSize) {
    const rows = await fetchPage(skip, batchSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      yield ndjsonLine({ type: "row", table, data: row });
    }
  }
  yield ndjsonLine({ type: "table_end", table });
}

function ndjsonLine(value: unknown) {
  return `${JSON.stringify(value, jsonReplacer)}\n`;
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function serializeJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, jsonReplacer)) as T;
}

function mappingWrite(mapping: MarketMapping) {
  return {
    id: mapping.marketTicker,
    marketTicker: mapping.marketTicker,
    city: mapping.location?.city ?? null,
    state: mapping.location?.state ?? null,
    stationId: mapping.station?.stationId ?? null,
    stationName: mapping.station?.stationName ?? null,
    settlementSource: mapping.settlementSource,
    variable: mapping.variable,
    threshold: mapping.threshold,
    thresholdOperator: mapping.thresholdOperator,
    targetDate: mapping.targetDate ? new Date(`${mapping.targetDate}T00:00:00Z`) : null,
    confidence: mapping.confidence,
    accepted: mapping.accepted,
    reviewReason: mapping.reviewReason,
    rawPayload: toJson(mapping)
  };
}

function quoteSnapshotWrite(market: KalshiMarketCandidate, observedAt: string, report: ScanReport) {
  return {
    id: `quote_${market.ticker}_${new Date(observedAt).getTime()}`,
    scanId: report.id,
    scanTrigger: report.trigger,
    scanCadenceMinutes: scanCadenceMinutesFor(report),
    marketTicker: market.ticker,
    eventTicker: market.eventTicker,
    observedAt: new Date(observedAt),
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    noBid: market.noBid,
    noAsk: market.noAsk,
    lastPrice: market.lastPrice,
    volume: market.volume,
    openInterest: market.openInterest,
    closeTime: optionalDate(market.closeTime),
    settlementTime: optionalDate(market.settlementTime),
    rawPayload: toJson(market.rawPayload)
  };
}

function candidateSnapshotWrite(candidate: TrainingCandidate, report: ScanReport) {
  return {
    id: candidate.id,
    scanId: candidate.scanId,
    scanTrigger: report.trigger,
    scanCadenceMinutes: scanCadenceMinutesFor(report),
    marketTicker: candidate.marketTicker,
    observedAt: new Date(candidate.createdAt),
    title: candidate.title,
    city: candidate.city,
    stationId: candidate.stationId,
    variable: candidate.variable,
    targetDate: candidate.targetDate ? new Date(`${candidate.targetDate}T00:00:00Z`) : null,
    threshold: candidate.threshold,
    thresholdOperator: candidate.thresholdOperator,
    forecastValue: candidate.forecastValue,
    entryPrice: candidate.entryPrice,
    yesProbability: candidate.yesProbability,
    impliedProbability: candidate.impliedProbability,
    edge: candidate.edge,
    spread: candidate.spread,
    liquidityScore: candidate.liquidityScore,
    status: candidate.status,
    blockers: toJson(candidate.blockers),
    settlementResult: candidate.settlementResult,
    counterfactualPnl: candidate.counterfactualPnl,
    reason: candidate.reason,
    rawPayload: toJson(candidate)
  };
}

function scanReportWrite(report: ScanReport) {
  return {
    id: report.id,
    startedAt: new Date(report.startedAt),
    completedAt: report.completedAt ? new Date(report.completedAt) : null,
    status: report.status,
    trigger: report.trigger,
    providerResults: toJson(report.providerResults),
    counts: toJson(report.counts),
    decisions: toJson(report.decisions)
  };
}

function marketsForQuoteSnapshots(markets: KalshiMarketCandidate[], report: ScanReport) {
  const refreshedTickers = new Set(
    report.providerResults
      .filter((result) => result.provider === "kalshi_quotes" && result.status === "ok")
      .map((result) => result.locationId)
  );
  if (report.trigger === "quote_refresh" && refreshedTickers.size > 0) {
    return markets.filter((market) => refreshedTickers.has(market.ticker));
  }
  return markets;
}

function scanCadenceMinutesFor(report: ScanReport) {
  if (report.trigger === "quote_refresh") return env.QUOTE_REFRESH_INTERVAL_MINUTES;
  if (report.trigger === "scheduled" || report.trigger === "startup") return env.BACKGROUND_POLL_INTERVAL_MINUTES;
  return null;
}

function simulatedContracts(entryPrice: number) {
  return Math.max(1, Math.min(activeRiskLimits.maxContractsPerTrade, Math.floor(env.MAX_STAKE_PER_TRADE_PAPER / Math.max(entryPrice, 0.01))));
}

function settlementPayout(side: string, result: string, contracts: number) {
  const normalizedSide = side.toLowerCase();
  const normalizedResult = result.toLowerCase();
  return normalizedSide === normalizedResult ? contracts : 0;
}

function modelForecastWrite(point: ModelForecastPoint) {
  return {
    id: point.id,
    locationId: point.locationId,
    city: point.city,
    state: point.state,
    stationId: point.stationId,
    model: point.model,
    modelRunAt: new Date(point.modelRunAt),
    forecastValidAt: new Date(point.forecastValidAt),
    targetDate: new Date(`${point.targetDate}T00:00:00Z`),
    horizonHours: point.horizonHours,
    highTempF: point.highTempF,
    lowTempF: point.lowTempF,
    precipitationAmountIn: point.precipitationAmountIn,
    precipitationProbabilityPct: point.precipitationProbabilityPct,
    windGustMph: point.windGustMph,
    uncertaintyStdDevF: point.uncertaintyStdDevF,
    freshnessMinutes: point.freshnessMinutes,
    confidence: point.confidence,
    rawPayload: toJson(point.rawPayload),
    createdAt: new Date(point.createdAt)
  };
}

function ensembleWrite(ensemble: EnsembleForecast) {
  return {
    id: ensemble.id,
    locationId: ensemble.locationId,
    city: ensemble.city,
    state: ensemble.state,
    stationId: ensemble.stationId,
    targetDate: new Date(`${ensemble.targetDate}T00:00:00Z`),
    variable: ensemble.variable,
    prediction: ensemble.prediction,
    uncertaintyStdDev: ensemble.uncertaintyStdDev,
    confidence: ensemble.confidence,
    contributingModels: toJson(ensemble.contributingModels),
    disagreement: ensemble.disagreement,
    reason: ensemble.reason,
    createdAt: new Date(ensemble.createdAt)
  };
}

function fromPrismaDelta(delta: {
  id: string;
  locationId: string;
  variable: string;
  targetDate: Date;
  oldValue: number;
  newValue: number;
  absoluteChange: number;
  probabilityChange: number | null;
  timeHorizonHours: number;
  confidence: string;
  reason: string;
  createdAt: Date;
}): ForecastDelta {
  return {
    id: delta.id,
    locationId: delta.locationId,
    city: delta.locationId,
    state: "",
    provider: "persisted",
    variable: delta.variable as ForecastDelta["variable"],
    targetDate: delta.targetDate.toISOString().slice(0, 10),
    oldValue: delta.oldValue,
    newValue: delta.newValue,
    absoluteChange: delta.absoluteChange,
    probabilityChange: delta.probabilityChange,
    timeHorizonHours: delta.timeHorizonHours,
    confidence: delta.confidence as ForecastDelta["confidence"],
    reason: delta.reason,
    createdAt: delta.createdAt.toISOString()
  };
}

function fromPrismaMarket(market: {
  ticker: string;
  eventTicker: string;
  title: string;
  subtitle: string | null;
  closeTime: Date | null;
  settlementTime: Date | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  volume: number | null;
  openInterest: number | null;
  rawPayload: Prisma.JsonValue;
}): KalshiMarketCandidate {
  return {
    ticker: market.ticker,
    eventTicker: market.eventTicker,
    title: market.title,
    subtitle: market.subtitle ?? undefined,
    closeTime: market.closeTime?.toISOString(),
    settlementTime: market.settlementTime?.toISOString(),
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    noBid: market.noBid,
    noAsk: market.noAsk,
    lastPrice: market.lastPrice,
    volume: market.volume,
    openInterest: market.openInterest,
    rawPayload: market.rawPayload
  };
}

function uniqueBy<T, K extends string>(items: T[], keyFor: (item: T) => K) {
  const byKey = new Map<K, T>();
  for (const item of items) byKey.set(keyFor(item), item);
  return [...byKey.values()];
}

function fromPrismaMapping(mapping: {
  marketTicker: string;
  market?: { eventTicker: string; title: string };
  city: string | null;
  state: string | null;
  stationId: string | null;
  stationName: string | null;
  settlementSource: string | null;
  variable: string;
  threshold: number | null;
  thresholdOperator: string;
  targetDate: Date | null;
  confidence: string;
  accepted: boolean;
  reviewReason: string | null;
  rawPayload: Prisma.JsonValue;
}): MarketMapping {
  const raw = mapping.rawPayload as Partial<MarketMapping>;
  return {
    marketTicker: mapping.marketTicker,
    eventTicker: raw.eventTicker ?? mapping.marketTicker,
    title: raw.title ?? mapping.marketTicker,
    location: mapping.city ? { city: mapping.city, state: mapping.state ?? undefined } : null,
    station: raw.station ?? (mapping.stationId && mapping.city ? { id: mapping.stationId, city: mapping.city, state: mapping.state ?? "", stationId: mapping.stationId, stationName: mapping.stationName ?? mapping.stationId, latitude: 0, longitude: 0, timezone: "UTC", aliases: [], settlementSource: (mapping.settlementSource ?? "unknown") as MarketMapping["settlementSource"], notes: "Persisted station reference" } : null),
    settlementSource: (mapping.settlementSource ?? "unknown") as MarketMapping["settlementSource"],
    variable: mapping.variable as MarketMapping["variable"],
    threshold: mapping.threshold,
    thresholdOperator: mapping.thresholdOperator as MarketMapping["thresholdOperator"],
    targetDate: mapping.targetDate?.toISOString().slice(0, 10) ?? null,
    confidence: mapping.confidence as MarketMapping["confidence"],
    accepted: mapping.accepted,
    reviewReason: mapping.reviewReason,
    liquidityScore: raw.liquidityScore ?? 0
  };
}

function fromPrismaSignal(signal: {
  id: string;
  marketTicker: string;
  side: string;
  action: string;
  contracts: number;
  limitPrice: number;
  maxCost: number;
  edge: number;
  confidence: string;
  explanation: string;
  status: string;
  skipReason: string | null;
  forecastDeltaId: string | null;
  createdAt: Date;
}): Signal {
  return {
    id: signal.id,
    marketTicker: signal.marketTicker,
    side: signal.side as Signal["side"],
    action: signal.action as Signal["action"],
    contracts: signal.contracts,
    limitPrice: signal.limitPrice,
    maxCost: signal.maxCost,
    edge: signal.edge,
    confidence: signal.confidence as Signal["confidence"],
    explanation: signal.explanation,
    status: signal.status as Signal["status"],
    skipReason: signal.skipReason,
    linkedDeltaId: signal.forecastDeltaId ?? "",
    createdAt: signal.createdAt.toISOString()
  };
}

function fromPrismaPaperOrder(order: {
  id: string;
  timestamp: Date;
  marketTicker: string;
  side: string;
  action: string;
  requestedContracts: number;
  limitPrice: number;
  simulatedAvgFillPrice: number | null;
  filledContracts: number;
  unfilledContracts: number;
  status: string;
  reason: string;
  signalId: string;
}): PaperOrder {
  return {
    id: order.id,
    timestamp: order.timestamp.toISOString(),
    marketTicker: order.marketTicker,
    side: order.side as PaperOrder["side"],
    action: order.action as PaperOrder["action"],
    requestedContracts: order.requestedContracts,
    limitPrice: order.limitPrice,
    simulatedAvgFillPrice: order.simulatedAvgFillPrice,
    filledContracts: order.filledContracts,
    unfilledContracts: order.unfilledContracts,
    status: order.status as PaperOrder["status"],
    reason: order.reason,
    linkedSignalId: order.signalId
  };
}

function fromPrismaSettlement(settlement: {
  id: string;
  marketTicker: string;
  result: string;
  settledPrice: number;
  source: string;
  rawPayload: Prisma.JsonValue;
  createdAt: Date;
}): Settlement {
  return {
    id: settlement.id,
    marketTicker: settlement.marketTicker,
    result: settlement.result as Settlement["result"],
    settledPrice: settlement.settledPrice,
    source: settlement.source,
    rawPayload: settlement.rawPayload,
    createdAt: settlement.createdAt.toISOString()
  };
}

function fromPrismaModelForecast(point: {
  id: string;
  locationId: string;
  city: string;
  state: string;
  stationId: string | null;
  model: string;
  modelRunAt: Date;
  forecastValidAt: Date;
  targetDate: Date;
  horizonHours: number;
  highTempF: number | null;
  lowTempF: number | null;
  precipitationAmountIn: number | null;
  precipitationProbabilityPct: number | null;
  windGustMph: number | null;
  uncertaintyStdDevF: number | null;
  freshnessMinutes: number;
  confidence: string;
  rawPayload: Prisma.JsonValue;
  createdAt: Date;
}): ModelForecastPoint {
  return {
    id: point.id,
    locationId: point.locationId,
    city: point.city,
    state: point.state,
    stationId: point.stationId,
    model: point.model as ModelForecastPoint["model"],
    modelRunAt: point.modelRunAt.toISOString(),
    forecastValidAt: point.forecastValidAt.toISOString(),
    targetDate: point.targetDate.toISOString().slice(0, 10),
    horizonHours: point.horizonHours,
    highTempF: point.highTempF,
    lowTempF: point.lowTempF,
    precipitationAmountIn: point.precipitationAmountIn,
    precipitationProbabilityPct: point.precipitationProbabilityPct,
    windGustMph: point.windGustMph,
    uncertaintyStdDevF: point.uncertaintyStdDevF,
    freshnessMinutes: point.freshnessMinutes,
    confidence: point.confidence as ModelForecastPoint["confidence"],
    rawPayload: point.rawPayload,
    createdAt: point.createdAt.toISOString()
  };
}

function fromPrismaEnsemble(ensemble: {
  id: string;
  locationId: string;
  city: string;
  state: string;
  stationId: string | null;
  targetDate: Date;
  variable: string;
  prediction: number | null;
  uncertaintyStdDev: number | null;
  confidence: string;
  contributingModels: Prisma.JsonValue;
  disagreement: number | null;
  reason: string;
  createdAt: Date;
}): EnsembleForecast {
  return {
    id: ensemble.id,
    locationId: ensemble.locationId,
    city: ensemble.city,
    state: ensemble.state,
    stationId: ensemble.stationId,
    targetDate: ensemble.targetDate.toISOString().slice(0, 10),
    variable: ensemble.variable as EnsembleForecast["variable"],
    prediction: ensemble.prediction,
    uncertaintyStdDev: ensemble.uncertaintyStdDev,
    confidence: ensemble.confidence as EnsembleForecast["confidence"],
    contributingModels: Array.isArray(ensemble.contributingModels) ? ensemble.contributingModels.map(String) : [],
    disagreement: ensemble.disagreement,
    reason: ensemble.reason,
    createdAt: ensemble.createdAt.toISOString()
  };
}

function optionalDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toJson(value: unknown): PrismaJson {
  return JSON.parse(JSON.stringify(value ?? null)) as PrismaJson;
}
