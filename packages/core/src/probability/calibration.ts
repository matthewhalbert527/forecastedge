export interface CalibrationObservation {
  predictedProbability: number;
  outcome: boolean;
}

export interface CalibrationBucketStats {
  minProbability: number;
  maxProbability: number;
  samples: number;
  averagePredictedProbability: number;
  observedWinRate: number;
  calibratedProbability: number;
}

export interface ProbabilityCalibrationMap {
  buckets: CalibrationBucketStats[];
  minSamples: number;
  totalSamples: number;
}

export interface CalibrationOptions {
  bucketCount?: number;
  minSamples?: number;
}

export function buildBucketCalibrationMap(
  observations: CalibrationObservation[],
  options: CalibrationOptions = {}
): ProbabilityCalibrationMap {
  const bucketCount = Math.max(2, options.bucketCount ?? 10);
  const minSamples = Math.max(1, options.minSamples ?? 30);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const minProbability = index / bucketCount;
    return {
      minProbability,
      maxProbability: (index + 1) / bucketCount,
      observations: [] as CalibrationObservation[]
    };
  });

  for (const observation of observations) {
    const probability = clamp01(observation.predictedProbability);
    const index = Math.min(bucketCount - 1, Math.floor(probability * bucketCount));
    buckets[index]?.observations.push({ predictedProbability: probability, outcome: observation.outcome });
  }

  const rawStats = buckets.map((bucket) => {
    const samples = bucket.observations.length;
    const averagePredictedProbability = samples > 0 ? average(bucket.observations.map((item) => item.predictedProbability)) : midpoint(bucket.minProbability, bucket.maxProbability);
    const observedWinRate = samples > 0 ? bucket.observations.filter((item) => item.outcome).length / samples : averagePredictedProbability;
    return {
      minProbability: bucket.minProbability,
      maxProbability: bucket.maxProbability,
      samples,
      averagePredictedProbability: round(averagePredictedProbability),
      observedWinRate: round(observedWinRate),
      calibratedProbability: round(observedWinRate)
    };
  });

  return {
    buckets: enforceMonotonicCalibration(rawStats),
    minSamples,
    totalSamples: observations.length
  };
}

export function calibrateProbability(rawProbability: number, calibrationMap?: ProbabilityCalibrationMap | null) {
  const raw = clamp01(rawProbability);
  if (!calibrationMap || calibrationMap.totalSamples < calibrationMap.minSamples) return round(raw);
  const bucket = calibrationMap.buckets.find((item) => raw >= item.minProbability && raw <= item.maxProbability)
    ?? calibrationMap.buckets[calibrationMap.buckets.length - 1];
  if (!bucket || bucket.samples < calibrationMap.minSamples) return round(raw);

  const confidence = Math.min(1, bucket.samples / Math.max(calibrationMap.minSamples * 3, 1));
  return round(raw * (1 - confidence) + bucket.calibratedProbability * confidence);
}

function enforceMonotonicCalibration(buckets: CalibrationBucketStats[]) {
  const adjusted = buckets.map((bucket) => ({ ...bucket }));
  for (let index = 1; index < adjusted.length; index += 1) {
    const previous = adjusted[index - 1];
    const current = adjusted[index];
    if (!previous || !current || current.calibratedProbability >= previous.calibratedProbability) continue;
    const totalSamples = previous.samples + current.samples;
    const pooled = totalSamples > 0
      ? (previous.calibratedProbability * previous.samples + current.calibratedProbability * current.samples) / totalSamples
      : midpoint(previous.calibratedProbability, current.calibratedProbability);
    previous.calibratedProbability = round(pooled);
    current.calibratedProbability = round(pooled);
  }
  return adjusted;
}

function midpoint(min: number, max: number) {
  return (min + max) / 2;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number) {
  return Number(value.toFixed(4));
}
