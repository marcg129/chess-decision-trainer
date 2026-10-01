import type { ReviewRating } from './types';

export const TARGET_DECISION_MS = 5_000;
export const EASY_DECISION_MS = 3_000;
export const MATERIAL_IMPROVEMENT_RATIO = 0.8;

export type ReviewGradeInput = {
  firstResponseCorrect: boolean;
  preferredMoveRecalled: boolean;
  acceptedAlternative: boolean;
  hintUsed: boolean;
  decisionTimeMs: number;
  historicalAverageDecisionTimeMs: number | null;
  priorScheduledReviews: number;
};

export function gradeReview(input: ReviewGradeInput): ReviewRating {
  if (!input.firstResponseCorrect || input.hintUsed) return 'again';
  if (input.acceptedAlternative || !input.preferredMoveRecalled) return 'hard';

  if (
    input.decisionTimeMs <= EASY_DECISION_MS
    && input.priorScheduledReviews >= 2
  ) {
    return 'easy';
  }

  if (input.decisionTimeMs <= TARGET_DECISION_MS) return 'good';

  if (
    input.historicalAverageDecisionTimeMs !== null
    && input.historicalAverageDecisionTimeMs > 0
    && input.decisionTimeMs
      <= input.historicalAverageDecisionTimeMs * MATERIAL_IMPROVEMENT_RATIO
  ) {
    return 'good';
  }

  return 'hard';
}
