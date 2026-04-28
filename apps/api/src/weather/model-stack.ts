import type { LocationConfig, ModelForecastPoint } from "@forecastedge/core";
import { env } from "../config/env.js";

interface OpenMeteoPayload {
  hourly?: Record<string, unknown[]>;
  daily?: Record<string, unknown[]>;
  generationtime_ms?: number;
}

export async function fetchModelForecasts(location: LocationConfig): Promise<ModelForecastPoint[]> {
  const points: ModelForecastPoint[] = [];
  const [hrrr] = await Promise.allSettled([fetchOpenMeteoHrrr(location)]);
  if (hrrr.status === "fulfilled") points.push(...hrrr.value);

  try {
    const ecmwf = await fetchOpenMeteoModel(location, "ecmwf_ifs", env.OPEN_METEO_ECMWF_MODEL);
    if (ecmwf.length > 0) {
      points.push(...ecmwf);
      return points;
    }
  } catch {
    // Fall through to the generic Open-Meteo model; the pipeline logs count and model label.
  }
  points.push(...await fetchOpenMeteoModel(location, "open_meteo_global", null));
  return points;
}

async function fetchOpenMeteoHrrr(location: LocationConfig) {
  const url = new URL(env.OPEN_METEO_GFS_BASE_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", location.timezone);
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("models", "best_match");
  url.searchParams.set("forecast_hours", "18");
  url.searchParams.set("hourly", "temperature_2m,precipitation,precipitation_probability,wind_gusts_10m");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`hrrr model forecast failed: ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as OpenMeteoPayload;
  const hourly = payload.hourly ?? {};
  const grouped = groupHourlyByDate(hourly);
  const now = new Date();

  return [...grouped.entries()].map(([targetDate, rows]) => {
    const temps = rows.map((row) => row.temperatureF).filter((value): value is number => value !== null);
    const gusts = rows.map((row) => row.windGustMph).filter((value): value is number => value !== null);
    const precip = rows.map((row) => row.precipitationAmountIn).filter((value): value is number => value !== null);
    const pop = rows.map((row) => row.precipitationProbabilityPct).filter((value): value is number => value !== null);
    const forecastValidAt = `${targetDate}T18:00:00.000Z`;
    const horizonHours = Math.max(0, Math.round((new Date(forecastValidAt).getTime() - now.getTime()) / 3_600_000));
    return {
      id: `hrrr_${location.id}_${targetDate}_${Date.now()}`,
      locationId: location.id,
      city: location.city,
      state: location.state,
      stationId: location.stationId ?? null,
      model: "hrrr",
      modelRunAt: now.toISOString(),
      forecastValidAt,
      targetDate,
      horizonHours,
      highTempF: temps.length ? Math.max(...temps) : null,
      lowTempF: temps.length ? Math.min(...temps) : null,
      precipitationAmountIn: precip.length ? round(precip.reduce((sum, value) => sum + value, 0)) : null,
      precipitationProbabilityPct: pop.length ? Math.max(...pop) : null,
      windGustMph: gusts.length ? Math.max(...gusts) : null,
      uncertaintyStdDevF: defaultUncertainty("hrrr", horizonHours),
      freshnessMinutes: 0,
      confidence: horizonHours <= 18 ? "high" : "medium",
      rawPayload: { modelParameter: "best_match", source: "open_meteo_gfs_hrrr", generationtime_ms: payload.generationtime_ms },
      createdAt: now.toISOString()
    } satisfies ModelForecastPoint;
  });
}

async function fetchOpenMeteoModel(location: LocationConfig, model: ModelForecastPoint["model"], modelParameter: string | null) {
  const url = new URL(`${env.OPEN_METEO_BASE_URL}/forecast`);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", location.timezone);
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  if (modelParameter) url.searchParams.set("models", modelParameter);
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

function groupHourlyByDate(hourly: Record<string, unknown[]>) {
  const grouped = new Map<string, Array<{ temperatureF: number | null; precipitationAmountIn: number | null; precipitationProbabilityPct: number | null; windGustMph: number | null }>>();
  for (const [index, value] of toArray(hourly.time).entries()) {
    const targetDate = String(value).slice(0, 10);
    if (!targetDate) continue;
    grouped.set(targetDate, [
      ...(grouped.get(targetDate) ?? []),
      {
        temperatureF: numberAt(hourly.temperature_2m, index),
        precipitationAmountIn: numberAt(hourly.precipitation, index),
        precipitationProbabilityPct: numberAt(hourly.precipitation_probability, index),
        windGustMph: numberAt(hourly.wind_gusts_10m, index)
      }
    ]);
  }
  return grouped;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
