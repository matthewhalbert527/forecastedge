import type { LocationConfig } from "@forecastedge/core";
import { env } from "../config/env.js";
import type { StationObservation } from "../data/store.js";

interface NwsObservationPayload {
  properties?: {
    timestamp?: string;
    temperature?: {
      value?: number | null;
      unitCode?: string;
    };
  };
}

export async function fetchNwsLatestStationObservation(location: LocationConfig): Promise<StationObservation | null> {
  if (!location.stationId || !location.stationName) return null;

  const url = new URL(`${env.NWS_BASE_URL}/stations/${location.stationId}/observations/latest`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": env.NWS_USER_AGENT,
      Accept: "application/geo+json"
    }
  });

  if (!response.ok) throw new Error(`NWS station observation failed for ${location.stationId}: ${response.status} ${response.statusText}`);

  const payload = (await response.json()) as NwsObservationPayload;
  const celsius = payload.properties?.temperature?.value;

  return {
    stationId: location.stationId,
    stationName: location.stationName,
    observedAt: payload.properties?.timestamp ?? new Date().toISOString(),
    temperatureF: typeof celsius === "number" ? Number(((celsius * 9) / 5 + 32).toFixed(1)) : null,
    rawPayload: payload
  };
}
