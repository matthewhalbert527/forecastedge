import type { Confidence, EnsembleForecast, ModelForecastPoint, WeatherVariable } from "../types.js";

const baseWeights: Record<string, number> = {
  hrrr: 1.25,
  meteomatics_us1k: 1.15,
  ecmwf_ifs: 1.05,
  graphcast: 0.95,
  gencast: 0.95,
  open_meteo_global: 0.7,
  weathermesh4: 0.7,
  earth2: 0.65,
  icon: 0.6
};

export function buildEnsembles(points: ModelForecastPoint[], now = new Date()): EnsembleForecast[] {
  const groups = new Map<string, ModelForecastPoint[]>();
  for (const point of points) {
    for (const variable of ["high_temp", "low_temp", "rainfall", "wind_gust"] as const) {
      const value = valueFor(point, variable);
      if (value === null) continue;
      const key = `${point.locationId}:${point.targetDate}:${variable}`;
      groups.set(key, [...(groups.get(key) ?? []), point]);
    }
  }

  return [...groups.entries()].map(([key, grouped]) => {
    const [, , variable] = key.split(":") as [string, string, EnsembleForecast["variable"]];
    const weighted = grouped.flatMap((point) => {
      const value = valueFor(point, variable);
      if (value === null) return [];
      const weight = modelWeight(point, variable);
      return [{ point, value, weight }];
    });
    const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
    const prediction = weightSum > 0 ? weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum : null;
    const disagreement = weighted.length > 1 ? weightedStdDev(weighted.map((item) => item.value)) : null;
    const first = grouped[0]!;
    const uncertainty = uncertaintyFor(weighted.map((item) => item.point), variable, disagreement);
    return {
      id: `ensemble_${first.locationId}_${first.targetDate}_${variable}`,
      locationId: first.locationId,
      city: first.city,
      state: first.state,
      stationId: first.stationId,
      targetDate: first.targetDate,
      variable,
      prediction: prediction === null ? null : round(prediction),
      uncertaintyStdDev: uncertainty,
      confidence: confidenceFor(grouped, uncertainty, now),
      contributingModels: [...new Set(grouped.map((point) => point.model))],
      disagreement: disagreement === null ? null : round(disagreement),
      reason: reasonFor(grouped, variable, prediction, disagreement),
      createdAt: now.toISOString()
    };
  });
}

export function modelWeight(point: ModelForecastPoint, variable: WeatherVariable) {
  const freshnessPenalty = point.freshnessMinutes > 360 ? 0.65 : point.freshnessMinutes > 120 ? 0.85 : 1;
  const horizonBoost = point.model === "hrrr" && point.horizonHours <= 18 ? 1.35 : point.model === "ecmwf_ifs" && point.horizonHours > 36 ? 1.15 : 1;
  const variableBoost = (variable === "high_temp" || variable === "low_temp") && point.model === "meteomatics_us1k" ? 1.15 : 1;
  return (baseWeights[point.model] ?? 0.5) * freshnessPenalty * horizonBoost * variableBoost;
}

function valueFor(point: ModelForecastPoint, variable: EnsembleForecast["variable"]) {
  if (variable === "high_temp") return point.highTempF;
  if (variable === "low_temp") return point.lowTempF;
  if (variable === "rainfall") return point.precipitationAmountIn;
  return point.windGustMph;
}

function uncertaintyFor(points: ModelForecastPoint[], variable: EnsembleForecast["variable"], disagreement: number | null) {
  const supplied = points.map((point) => point.uncertaintyStdDevF).filter((value): value is number => typeof value === "number");
  const baseline = variable === "high_temp" || variable === "low_temp" ? 3 : variable === "rainfall" ? 0.15 : 6;
  const modelUncertainty = supplied.length ? supplied.reduce((sum, value) => sum + value, 0) / supplied.length : baseline;
  return round(Math.max(modelUncertainty, disagreement ?? 0));
}

function confidenceFor(points: ModelForecastPoint[], uncertainty: number | null, now: Date): Confidence {
  const fresh = points.filter((point) => now.getTime() - new Date(point.createdAt).getTime() < 6 * 60 * 60 * 1000);
  if (fresh.length >= 2 && uncertainty !== null && uncertainty <= 3) return "high";
  if (fresh.length >= 1 && uncertainty !== null && uncertainty <= 5) return "medium";
  return "low";
}

function reasonFor(points: ModelForecastPoint[], variable: string, prediction: number | null, disagreement: number | null) {
  const models = [...new Set(points.map((point) => point.model))].join(", ");
  return `${variable} ensemble ${prediction === null ? "n/a" : round(prediction)} from ${models}; model disagreement ${disagreement === null ? "n/a" : round(disagreement)}`;
}

function weightedStdDev(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round(value: number) {
  return Number(value.toFixed(4));
}
