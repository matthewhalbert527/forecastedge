import {
  KALSHI_SETTLEMENT_STATIONS,
  stationToLocationConfig,
  type ForecastDelta,
  type KalshiMarketCandidate,
  type LocationConfig,
  type MarketMapping,
  type EnsembleForecast,
  type ModelForecastPoint,
  type NormalizedForecastSnapshot,
  type PaperOrder,
  type Signal,
  type TrainingCandidate
} from "@forecastedge/core";

export const defaultLocation: LocationConfig = {
  ...stationToLocationConfig(KALSHI_SETTLEMENT_STATIONS.find((station) => station.stationId === "KMIA") ?? KALSHI_SETTLEMENT_STATIONS[0]!, 30)
};

export interface StationObservation {
  stationId: string;
  stationName: string;
  observedAt: string;
  temperatureF: number | null;
  rawPayload: unknown;
}

export interface ScanReport {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "completed_with_errors" | "failed";
  trigger: "manual" | "scheduled" | "startup" | "quote_refresh";
  providerResults: Array<{
    provider: string;
    locationId: string;
    stationId?: string | undefined;
    status: "ok" | "skipped" | "error";
    message: string;
  }>;
  counts: {
    forecastSnapshots: number;
    stationObservations: number;
    forecastDeltas: number;
    marketsDiscovered: number;
    mappingsAccepted: number;
    mappingsRejected: number;
    signalsFired: number;
    signalsSkipped: number;
    paperOrders: number;
    trainingCandidates: number;
    modelForecasts: number;
    ensembles: number;
  };
  decisions: Array<{
    stage: "provider" | "model_forecast" | "model_ensemble" | "market_mapping" | "training_candidate" | "signal" | "paper_order" | "settlement";
    itemId: string;
    status: "accepted" | "rejected" | "fired" | "skipped" | "filled" | "partial" | "error";
    reason: string;
    metadata: unknown;
  }>;
}

export class MemoryStore {
  locations: LocationConfig[] = KALSHI_SETTLEMENT_STATIONS.map((station) => stationToLocationConfig(station, 30));
  forecastSnapshots: NormalizedForecastSnapshot[] = [];
  forecastDeltas: ForecastDelta[] = [];
  markets: KalshiMarketCandidate[] = [];
  mappings: MarketMapping[] = [];
  signals: Signal[] = [];
  paperOrders: PaperOrder[] = [];
  trainingCandidates: TrainingCandidate[] = [];
  modelForecasts: ModelForecastPoint[] = [];
  ensembles: EnsembleForecast[] = [];
  stationObservations: StationObservation[] = [];
  scanReports: ScanReport[] = [];
  providerCooldowns: Record<string, string> = {};

  latestSnapshot(locationId: string, provider: string) {
    return this.forecastSnapshots.find((snapshot) => snapshot.location.id === locationId && snapshot.provider === provider) ?? null;
  }

  providerAvailable(provider: string, locationId: string, now = new Date()) {
    const until = this.providerCooldowns[`${provider}:${locationId}`];
    return !until || new Date(until).getTime() <= now.getTime();
  }

  coolDownProvider(provider: string, locationId: string, minutes: number, now = new Date()) {
    const until = new Date(now.getTime() + minutes * 60_000).toISOString();
    this.providerCooldowns[`${provider}:${locationId}`] = until;
    return until;
  }

  startScan(trigger: ScanReport["trigger"]) {
    const report: ScanReport = {
      id: `scan_${Date.now()}_${this.scanReports.length}`,
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "running",
      trigger,
      providerResults: [],
      counts: {
        forecastSnapshots: 0,
        stationObservations: 0,
        forecastDeltas: 0,
        marketsDiscovered: 0,
        mappingsAccepted: 0,
        mappingsRejected: 0,
        signalsFired: 0,
        signalsSkipped: 0,
        paperOrders: 0,
        trainingCandidates: 0,
        modelForecasts: 0,
        ensembles: 0
      },
      decisions: []
    };
    this.scanReports.unshift(report);
    this.scanReports = this.scanReports.slice(0, 50);
    return report;
  }

  pruneHistory() {
    this.forecastSnapshots = this.forecastSnapshots.slice(0, 500);
    this.forecastDeltas = this.forecastDeltas.slice(0, 1_000);
    this.markets = this.markets.slice(0, 2_000);
    this.mappings = this.mappings.slice(0, 2_000);
    this.signals = this.signals.slice(0, 1_000);
    this.paperOrders = this.paperOrders.slice(0, 1_000);
    this.trainingCandidates = this.trainingCandidates.slice(0, 1_000);
    this.modelForecasts = this.modelForecasts.slice(0, 3_000);
    this.ensembles = this.ensembles.slice(0, 1_000);
    this.stationObservations = this.stationObservations.slice(0, 500);
    this.scanReports = this.scanReports.slice(0, 50).map((report) => ({
      ...report,
      providerResults: report.providerResults.slice(0, 200),
      decisions: report.decisions.slice(0, 500)
    }));
  }
}
