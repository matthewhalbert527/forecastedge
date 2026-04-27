import type { LocationConfig, NormalizedForecastSnapshot } from "@forecastedge/core";
import { env } from "../config/env.js";

export async function fetchAccuWeatherDailyForecast(location: LocationConfig): Promise<NormalizedForecastSnapshot | null> {
  if (!env.ACCUWEATHER_API_KEY || !location.accuweatherLocationKey) return null;

  const url = new URL(`${env.ACCUWEATHER_BASE_URL}/forecasts/v1/daily/5day/${location.accuweatherLocationKey}`);
  url.searchParams.set("apikey", env.ACCUWEATHER_API_KEY);
  url.searchParams.set("details", "true");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`AccuWeather forecast failed for ${location.id}: ${response.status} ${response.statusText}`);

  const payload = await response.json() as {
    DailyForecasts?: Array<{
      Date?: string;
      Temperature?: { Maximum?: { Value?: number; Unit?: string }; Minimum?: { Value?: number; Unit?: string } };
      Day?: { PrecipitationProbability?: number; Rain?: { Value?: number }; Snow?: { Value?: number }; WindGust?: { Speed?: { Value?: number } } };
    }>;
  };
  const now = new Date().toISOString();

  return {
    id: `accuweather_${location.id}_${Date.now()}`,
    provider: "accuweather",
    location,
    forecastRunAt: now,
    hourly: [],
    daily: (payload.DailyForecasts ?? []).map((day) => ({
      targetDate: day.Date ? day.Date.slice(0, 10) : now.slice(0, 10),
      highTempF: normalizeTempF(day.Temperature?.Maximum?.Value ?? null, day.Temperature?.Maximum?.Unit),
      lowTempF: normalizeTempF(day.Temperature?.Minimum?.Value ?? null, day.Temperature?.Minimum?.Unit),
      precipitationProbabilityPct: day.Day?.PrecipitationProbability ?? null,
      precipitationAmountIn: day.Day?.Rain?.Value ?? null,
      snowAmountIn: day.Day?.Snow?.Value ?? null,
      windSpeedMph: null,
      windGustMph: day.Day?.WindGust?.Speed?.Value ?? null
    })),
    rawPayload: payload,
    createdAt: now
  };
}

function normalizeTempF(value: number | null, unit: string | undefined) {
  if (value === null) return null;
  if (unit?.toUpperCase() === "C") return Number(((value * 9) / 5 + 32).toFixed(1));
  return value;
}
