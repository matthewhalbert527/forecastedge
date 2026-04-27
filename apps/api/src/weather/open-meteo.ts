import type { LocationConfig, NormalizedForecastSnapshot } from "@forecastedge/core";
import { env } from "../config/env.js";

interface OpenMeteoPayload {
  hourly?: Record<string, unknown[]>;
  daily?: Record<string, unknown[]>;
}

export async function fetchOpenMeteoForecast(location: LocationConfig): Promise<NormalizedForecastSnapshot> {
  const url = new URL(`${env.OPEN_METEO_BASE_URL}/forecast`);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", location.timezone);
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo forecast failed: ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as OpenMeteoPayload;
  const hourly = payload.hourly ?? {};
  const daily = payload.daily ?? {};
  const now = new Date().toISOString();

  return {
    id: `open_meteo_${location.id}_${Date.now()}`,
    provider: "open_meteo",
    location,
    forecastRunAt: now,
    hourly: toArray(hourly.time).map((time, index) => ({
      time: String(time),
      temperatureF: numberAt(hourly.temperature_2m, index),
      precipitationProbabilityPct: numberAt(hourly.precipitation_probability, index),
      precipitationAmountIn: numberAt(hourly.precipitation, index),
      snowAmountIn: numberAt(hourly.snowfall, index),
      windSpeedMph: numberAt(hourly.wind_speed_10m, index),
      windGustMph: numberAt(hourly.wind_gusts_10m, index),
      humidityPct: numberAt(hourly.relative_humidity_2m, index)
    })),
    daily: toArray(daily.time).map((date, index) => ({
      targetDate: String(date),
      highTempF: numberAt(daily.temperature_2m_max, index),
      lowTempF: numberAt(daily.temperature_2m_min, index),
      precipitationProbabilityPct: numberAt(daily.precipitation_probability_max, index),
      precipitationAmountIn: numberAt(daily.precipitation_sum, index),
      snowAmountIn: numberAt(daily.snowfall_sum, index),
      windSpeedMph: numberAt(daily.wind_speed_10m_max, index),
      windGustMph: numberAt(daily.wind_gusts_10m_max, index)
    })),
    rawPayload: payload,
    createdAt: now
  };
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberAt(value: unknown, index: number): number | null {
  const item = Array.isArray(value) ? value[index] : null;
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}
