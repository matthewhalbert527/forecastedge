import {
  KALSHI_SETTLEMENT_STATIONS,
  stationToLocationConfig,
  type ForecastDelta,
  type KalshiMarketCandidate,
  type LocationConfig,
  type MarketMapping,
  type NormalizedForecastSnapshot,
  type PaperOrder,
  type Signal
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
  trigger: "manual" | "scheduled" | "startup";
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
  };
  decisions: Array<{
    stage: "provider" | "market_mapping" | "signal" | "paper_order";
    itemId: string;
    status: "accepted" | "rejected" | "fired" | "skipped" | "filled" | "partial" | "error";
    reason: string;
    metadata: unknown;
  }>;
}

export class MemoryStore {
  locations: LocationConfig[] = [defaultLocation];
  forecastSnapshots: NormalizedForecastSnapshot[] = [];
  forecastDeltas: ForecastDelta[] = [];
  markets: KalshiMarketCandidate[] = [];
  mappings: MarketMapping[] = [];
  signals: Signal[] = [];
  paperOrders: PaperOrder[] = [];
  stationObservations: StationObservation[] = [];
  scanReports: ScanReport[] = [];

  latestSnapshot(locationId: string, provider: string) {
    return this.forecastSnapshots.find((snapshot) => snapshot.location.id === locationId && snapshot.provider === provider) ?? null;
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
        paperOrders: 0
      },
      decisions: []
    };
    this.scanReports.unshift(report);
    this.scanReports = this.scanReports.slice(0, 50);
    return report;
  }
}
