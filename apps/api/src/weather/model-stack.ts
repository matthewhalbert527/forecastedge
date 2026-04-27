import type { LocationConfig, ModelForecastPoint } from "@forecastedge/core";
import { env } from "../config/env.js";

interface OpenMeteoPayload {
  hourly?: Record<string, unknown[]>;
  daily?: Record<string, unknown[]>;
  generationtime_ms?: number;
}

export async function fetchModelForecasts(location: LocationConfig): Promise<ModelForecastPoint[]> {
  const [ecmwf] = await Promise.allSettled([fetchOpenMeteoModel(location, "ecmwf_ifs", env.OPEN_METEO_ECMWF_MODEL)]);
  const points: ModelForecastPoint[] = [];
  if (ecmwf.status === "fulfilled") points.push(...ecmwf.value);
  return points;
}

async function fetchOpenMeteoModel(location: LocationConfig, model: ModelForecastPoint["model"], modelParameter: string) {
  const url = new URL(`${env.OPEN_METEO_BASE_URL}/forecast`);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", location.timezone);
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("models", modelParameter);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${model} model forecast failed: ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as OpenMeteoPayload;
  const daily = payload.daily ?? {};
  const now = new Date();
  const modelRunAt = now.toISOString();
  return toArray(daily.time).map((date, index) => {
    const targetDate = String(date);
    const forecastValidAt = `${targetDate}T18:00:00.000Z`;
    const horizonHours = Math.max(0, Math.round((new Date(forecastValidAt).getTime() - now.getTime()) / 3_600_000));
    return {
      id: `${model}_${location.id}_${targetDate}_${Date.now()}`,
      locationId: location.id,
      city: location.city,
      state: location.state,
      stationId: location.stationId ?? null,
      model,
      modelRunAt,
      forecastValidAt,
      targetDate,
      horizonHours,
      highTempF: numberAt(daily.temperature_2m_max, index),
      lowTempF: numberAt(daily.temperature_2m_min, index),
      precipitationAmountIn: numberAt(daily.precipitation_sum, index),
      precipitationProbabilityPct: numberAt(daily.precipitation_probability_max, index),
      windGustMph: numberAt(daily.wind_gusts_10m_max, index),
      uncertaintyStdDevF: defaultUncertainty(model, horizonHours),
      freshnessMinutes: 0,
      confidence: model === "ecmwf_ifs" ? "medium" : "low",
      rawPayload: { modelParameter, generationtime_ms: payload.generationtime_ms },
      createdAt: modelRunAt
    } satisfies ModelForecastPoint;
  });
}

export function unavailableModelPoint(location: LocationConfig, model: ModelForecastPoint["model"], reason: string): ModelForecastPoint {
  const now = new Date().toISOString();
  const targetDate = now.slice(0, 10);
  return {
    id: `${model}_${location.id}_unavailable_${Date.now()}`,
    locationId: location.id,
    city: location.city,
    state: location.state,
    stationId: location.stationId ?? null,
    model,
    modelRunAt: now,
    forecastValidAt: now,
    targetDate,
    horizonHours: 0,
    highTempF: null,
    lowTempF: null,
    precipitationAmountIn: null,
    precipitationProbabilityPct: null,
    windGustMph: null,
    uncertaintyStdDevF: null,
    freshnessMinutes: 0,
    confidence: "low",
    rawPayload: { unavailable: true, reason },
    createdAt: now
  };
}

function defaultUncertainty(model: ModelForecastPoint["model"], horizonHours: number) {
  if (model === "ecmwf_ifs") return horizonHours <= 42 ? 3 : 4.5;
  if (model === "hrrr") return horizonHours <= 6 ? 1.5 : 2.25;
  return null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberAt(value: unknown, index: number): number | null {
  const item = Array.isArray(value) ? value[index] : null;
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}
