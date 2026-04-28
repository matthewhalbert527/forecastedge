import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildPaperPositionsFromOrders,
  summarizePaperOrders,
  type EnsembleForecast,
  type ForecastDelta,
  type KalshiMarketCandidate,
  type MarketMapping,
  type ModelForecastPoint,
  type NormalizedForecastSnapshot,
  type PaperOrder,
  type Settlement,
  type Signal,
  type TrainingCandidate
} from "@forecastedge/core";
import type { AuditEntry } from "../audit/audit-log.js";
import { activeRiskLimits, env } from "../config/env.js";
import type { ScanReport, StationObservation, MemoryStore } from "./store.js";
import { buildTrainingCandidates } from "../jobs/training-candidates.js";

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

    const learning = await this.learningSummary();

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
    const [quoteSnapshots, candidateSnapshots, paperExamples, settledPaperExamples, scanReports, fullScans, quoteRefreshScans, latestQuote, latestCandidate, latestFullScan, latestQuoteRefresh, recentExamples] = await Promise.all([
      this.prisma.marketQuoteSnapshot.count(),
      this.prisma.candidateDecisionSnapshot.count(),
      this.prisma.paperTradeTrainingExample.count(),
      this.prisma.paperTradeTrainingExample.count({ where: { status: { in: ["won", "lost"] } } }),
      this.prisma.scanReport.count(),
      this.prisma.scanReport.count({ where: { trigger: { not: "quote_refresh" } } }),
      this.prisma.scanReport.count({ where: { trigger: "quote_refresh" } }),
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
      strategyRuns
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
      this.prisma.strategyRun.findMany({ orderBy: { startedAt: "asc" } })
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
        strategyRuns
      },
      modelTrainingRows
    };
  }

  async runStoredBacktest(parameters: Record<string, unknown> = {}) {
    const summary = await this.backtestStoredWouldBuys();
    const run = await this.prisma.strategyRun.create({
      data: {
        mode: env.APP_MODE,
        parameters: toJson({ strategy: "stored_would_buy_v1", ...parameters }),
        completedAt: new Date(),
        summary: toJson(summary)
      }
    });
    return {
      id: run.id,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      summary
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

  private async persistMarkets(markets: KalshiMarketCandidate[]) {
    for (const market of markets) {
      await this.prisma.kalshiMarket.upsert({
        where: { ticker: market.ticker },
        create: marketWrite(market),
        update: marketWrite(market)
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

  private async backtestStoredWouldBuys() {
    const [snapshots, settlements] = await Promise.all([
      this.prisma.candidateDecisionSnapshot.findMany({
        where: { status: "WOULD_BUY", entryPrice: { not: null } },
        orderBy: { observedAt: "asc" },
        take: 10000
      }),
      this.prisma.settlement.findMany()
    ]);
    const settlementByTicker = new Map(settlements.map((settlement) => [settlement.marketTicker, settlement]));
    const seenMarkets = new Set<string>();
    let simulatedTrades = 0;
    let wins = 0;
    let losses = 0;
    let totalCost = 0;
    let totalPayout = 0;

    for (const snapshot of snapshots) {
      if (seenMarkets.has(snapshot.marketTicker)) continue;
      const settlement = settlementByTicker.get(snapshot.marketTicker);
      if (!settlement || snapshot.entryPrice === null) continue;
      seenMarkets.add(snapshot.marketTicker);
      const contracts = simulatedContracts(snapshot.entryPrice);
      const cost = snapshot.entryPrice * contracts;
      const payout = settlement.result === "yes" ? contracts : 0;
      const pnl = payout - cost;
      simulatedTrades += 1;
      totalCost += cost;
      totalPayout += payout;
      if (pnl >= 0) wins += 1;
      else losses += 1;
    }

    const totalPnl = totalPayout - totalCost;
    return {
      method: "first stored WOULD_BUY per settled market",
      candidateSnapshots: snapshots.length,
      evaluatedMarkets: simulatedTrades,
      wins,
      losses,
      winRate: simulatedTrades > 0 ? Number((wins / simulatedTrades).toFixed(4)) : 0,
      totalCost: Number(totalCost.toFixed(4)),
      totalPayout: Number(totalPayout.toFixed(4)),
      totalPnl: Number(totalPnl.toFixed(4)),
      roi: totalCost > 0 ? Number((totalPnl / totalCost).toFixed(4)) : 0
    };
  }
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
