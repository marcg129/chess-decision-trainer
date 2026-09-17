export type WeightedCandidate<T> = { value: T; weight: number };

export function chooseWeighted<T>(
  candidates: WeightedCandidate<T>[],
  random: () => number,
): T {
  if (candidates.length === 0) throw new Error('Weighted choice requires at least one candidate.');
  const total = candidates.reduce(
    (sum, candidate) => sum + (Number.isFinite(candidate.weight) && candidate.weight > 0 ? candidate.weight : 0),
    0,
  );
  if (total <= 0) throw new Error('Weighted choice requires a positive total weight.');

  const sample = random();
  const normalized = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0;
  const target = normalized * total;
  let cumulative = 0;
  let lastPositive = candidates[0].value;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.weight) || candidate.weight <= 0) continue;
    lastPositive = candidate.value;
    cumulative += candidate.weight;
    if (target < cumulative) return candidate.value;
  }
  return lastPositive;
}

export function opponentResponseWeight({
  destinationAttempts,
  sessionExposure,
}: {
  destinationAttempts: number;
  sessionExposure: number;
}): number {
  return 1 / (
    1 + Math.max(0, destinationAttempts) + Math.max(0, sessionExposure) * 2
  );
}

export function quickRecallWeight(input: {
  attempts: number;
  incorrect: number;
  hintedAttempts: number;
  slowAttempts: number;
}): number {
  if (input.attempts <= 0) return 7;
  const attempts = Math.max(1, input.attempts);
  return 1
    + (Math.max(0, input.incorrect) / attempts) * 4
    + (Math.max(0, input.hintedAttempts) / attempts) * 2
    + (Math.max(0, input.slowAttempts) / attempts) * 2;
}
