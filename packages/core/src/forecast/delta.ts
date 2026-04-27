import type { ForecastDelta, NormalizedForecastSnapshot, WeatherVariable } from "../types.js";

export interface DeltaThresholds {
  highTempF: number;
  lowTempF: number;
  rainProbabilityPct: number;
  rainAmountIn: number;
  snowAmountIn: number;
  windGustMph: number;
}

export const defaultDeltaThresholds: DeltaThresholds = {
  highTempF: 2,
  lowTempF: 2,
  rainProbabilityPct: 15,
  rainAmountIn: 0.1,
  snowAmountIn: 0.5,
  windGustMph: 10
};

export function detectForecastDeltas(
  previous: NormalizedForecastSnapshot | null,
  latest: NormalizedForecastSnapshot,
  thresholds: DeltaThresholds = defaultDeltaThresholds
): ForecastDelta[] {
  if (!previous) return [];
  const previousByDate = new Map(previous.daily.map((day) => [day.targetDate, day]));
  const createdAt = new Date().toISOString();
  const deltas: ForecastDelta[] = [];

  for (const day of latest.daily) {
    const old = previousByDate.get(day.targetDate);
    if (!old) continue;

    addNumericDelta(deltas, latest, day.targetDate, "high_temp", old.highTempF, day.highTempF, thresholds.highTempF, createdAt);
    addNumericDelta(deltas, latest, day.targetDate, "low_temp", old.lowTempF, day.lowTempF, thresholds.lowTempF, createdAt);
    addNumericDelta(
      deltas,
      latest,
      day.targetDate,
      "rainfall",
      old.precipitationProbabilityPct,
      day.precipitationProbabilityPct,
      thresholds.rainProbabilityPct,
      createdAt,
      true
    );
    addThresholdCrossingDelta(
      deltas,
      latest,
      day.targetDate,
      "rainfall",
      old.precipitationAmountIn,
      day.precipitationAmountIn,
      thresholds.rainAmountIn,
      createdAt
    );
    addThresholdCrossingDelta(
      deltas,
      latest,
      day.targetDate,
      "snowfall",
      old.snowAmountIn,
      day.snowAmountIn,
      thresholds.snowAmountIn,
      createdAt
    );
    addThresholdCrossingDelta(
      deltas,
      latest,
      day.targetDate,
      "wind_gust",
      old.windGustMph,
      day.windGustMph,
      thresholds.windGustMph,
      createdAt
    );
  }

  return deltas;
}

function addNumericDelta(
  out: ForecastDelta[],
  latest: NormalizedForecastSnapshot,
  targetDate: string,
  variable: WeatherVariable,
  oldValue: number | null,
  newValue: number | null,
  threshold: number,
  createdAt: string,
  probability = false
) {
  if (oldValue === null || newValue === null) return;
  const absoluteChange = Number((newValue - oldValue).toFixed(2));
  if (Math.abs(absoluteChange) < threshold) return;
  out.push(makeDelta(latest, targetDate, variable, oldValue, newValue, absoluteChange, probability ? absoluteChange : null, createdAt));
}

function addThresholdCrossingDelta(
  out: ForecastDelta[],
  latest: NormalizedForecastSnapshot,
  targetDate: string,
  variable: WeatherVariable,
  oldValue: number | null,
  newValue: number | null,
  threshold: number,
  createdAt: string
) {
  if (oldValue === null || newValue === null) return;
  const crossed = (oldValue < threshold && newValue >= threshold) || (oldValue >= threshold && newValue < threshold);
  if (!crossed) return;
  const absoluteChange = Number((newValue - oldValue).toFixed(2));
  out.push(makeDelta(latest, targetDate, variable, oldValue, newValue, absoluteChange, null, createdAt, `crossed ${threshold}`));
}

function makeDelta(
  latest: NormalizedForecastSnapshot,
  targetDate: string,
  variable: WeatherVariable,
  oldValue: number,
  newValue: number,
  absoluteChange: number,
  probabilityChange: number | null,
  createdAt: string,
  extraReason?: string
): ForecastDelta {
  const horizonMs = new Date(`${targetDate}T12:00:00Z`).getTime() - new Date(latest.forecastRunAt).getTime();
  const timeHorizonHours = Math.max(0, Math.round(horizonMs / 36e5));
  return {
    id: `${latest.id}:${targetDate}:${variable}:${outcomeKey(oldValue, newValue)}`,
    locationId: latest.location.id,
    city: latest.location.city,
    state: latest.location.state,
    provider: latest.provider,
    variable,
    targetDate,
    oldValue,
    newValue,
    absoluteChange,
    probabilityChange,
    timeHorizonHours,
    confidence: timeHorizonHours <= 36 ? "high" : timeHorizonHours <= 84 ? "medium" : "low",
    reason: `${variable} changed from ${oldValue} to ${newValue}${extraReason ? ` and ${extraReason}` : ""}`,
    createdAt
  };
}

function outcomeKey(oldValue: number, newValue: number) {
  return `${oldValue}->${newValue}`.replaceAll(".", "_");
}
