import { createId, type EntityId, type PositionMastery, type RepertoireMoveMastery } from './types';

export type MasteryOutcome = {
  correct: boolean;
  decisionTimeMs: number;
};

export function updateAverage(
  previousAverage: number | null,
  previousCount: number,
  value: number,
): number {
  if (previousAverage === null || previousCount === 0) return value;
  return (previousAverage * previousCount + value) / (previousCount + 1);
}

export function nextPositionMastery(
  current: PositionMastery | undefined,
  positionId: EntityId,
  outcome: MasteryOutcome,
  timestamp: string,
): PositionMastery {
  const previousAttempts = current?.attempts ?? 0;
  return {
    id: current?.id ?? createId(),
    positionId,
    attempts: previousAttempts + 1,
    correct: (current?.correct ?? 0) + (outcome.correct ? 1 : 0),
    incorrect: (current?.incorrect ?? 0) + (outcome.correct ? 0 : 1),
    averageDecisionTimeMs: updateAverage(
      current?.averageDecisionTimeMs ?? null,
      previousAttempts,
      outcome.decisionTimeMs,
    ),
    lastSeenAt: timestamp,
    state: current?.state ?? 'new',
    score: current?.score ?? 0,
    nextReviewAt: current?.nextReviewAt ?? null,
    schedulingData: current?.schedulingData ?? null,
    updatedAt: timestamp,
  };
}

export function nextRepertoireMoveMastery(
  current: RepertoireMoveMastery | undefined,
  repertoireMoveId: EntityId,
  outcome: MasteryOutcome,
  timestamp: string,
): RepertoireMoveMastery {
  const previousAttempts = current?.attempts ?? 0;
  return {
    id: current?.id ?? createId(),
    repertoireMoveId,
    attempts: previousAttempts + 1,
    correct: (current?.correct ?? 0) + (outcome.correct ? 1 : 0),
    incorrect: (current?.incorrect ?? 0) + (outcome.correct ? 0 : 1),
    streak: outcome.correct ? (current?.streak ?? 0) + 1 : 0,
    averageDecisionTimeMs: updateAverage(
      current?.averageDecisionTimeMs ?? null,
      previousAttempts,
      outcome.decisionTimeMs,
    ),
    lastAttemptedAt: timestamp,
    state: current?.state ?? 'new',
    score: current?.score ?? 0,
    nextReviewAt: current?.nextReviewAt ?? null,
    schedulingData: current?.schedulingData ?? null,
    updatedAt: timestamp,
  };
}
