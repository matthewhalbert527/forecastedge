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

export class MemoryStore {
  locations: LocationConfig[] = [defaultLocation];
  forecastSnapshots: NormalizedForecastSnapshot[] = [];
  forecastDeltas: ForecastDelta[] = [];
  markets: KalshiMarketCandidate[] = [];
  mappings: MarketMapping[] = [];
  signals: Signal[] = [];
  paperOrders: PaperOrder[] = [];
  stationObservations: StationObservation[] = [];

  latestSnapshot(locationId: string, provider: string) {
    return this.forecastSnapshots.find((snapshot) => snapshot.location.id === locationId && snapshot.provider === provider) ?? null;
  }
}
