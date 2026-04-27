import type { LocationConfig } from "@forecastedge/core";
import { env } from "../config/env.js";

export async function fetchNwsAlerts(location: LocationConfig) {
  const url = new URL(`${env.NWS_BASE_URL}/alerts/active`);
  url.searchParams.set("point", `${location.latitude},${location.longitude}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": env.NWS_USER_AGENT,
      Accept: "application/geo+json"
    }
  });
  if (!response.ok) throw new Error(`NWS alerts failed: ${response.status} ${response.statusText}`);
  return response.json();
}
