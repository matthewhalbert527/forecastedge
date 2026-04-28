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
  type Signal
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
    await this.persistSignals(store.signals, report);
    await this.persistPaperOrders(store.paperOrders);
    await this.rebuildPaperPositions();
    await this.persistAudit(auditEntries);
    await this.persistScanReport(report);
  }

  async dashboardSummary(fallback: MemoryStore) {
    const [scanReports, snapshots, stationObservations, deltas, markets, mappings, signals, paperOrders, positions, settlements, auditLogs, modelForecasts, ensembles] = await Promise.all([
      this.prisma.scanReport.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
      this.prisma.forecastSnapshot.findMany({ include: { location: true }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.stationObservation.findMany({ orderBy: { observedAt: "desc" }, take: 20 }),
      this.prisma.forecastDelta.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.kalshiMarket.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
      this.prisma.marketMapping.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.signal.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.paperOrder.findMany({ orderBy: { timestamp: "desc" }, take: 100 }),
      this.prisma.paperPosition.findMany({ orderBy: { openedAt: "desc" }, take: 100 }),
      this.prisma.settlement.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.modelForecast.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.ensembleForecast.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
    ]);

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
    const typedMarkets = markets.map(fromPrismaMarket);
    const typedMappings = mappings.map(fromPrismaMapping);
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
