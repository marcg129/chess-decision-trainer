import { describe, expect, it } from 'vitest';
import { gradeReview, type ReviewGradeInput } from './grader';

function input(overrides: Partial<ReviewGradeInput> = {}): ReviewGradeInput {
  return {
    firstResponseCorrect: true,
    preferredMoveRecalled: true,
    acceptedAlternative: false,
    hintUsed: false,
    decisionTimeMs: 4_000,
    historicalAverageDecisionTimeMs: null,
    priorScheduledReviews: 0,
    ...overrides,
  };
}

describe('automatic Review Due grading', () => {
  it('grades a wrong first response Again', () => {
    expect(gradeReview(input({ firstResponseCorrect: false }))).toBe('again');
  });

  it('grades hint-assisted recall Again', () => {
    expect(gradeReview(input({ hintUsed: true }))).toBe('again');
  });

  it('grades an accepted alternative Hard', () => {
    expect(
      gradeReview(input({
        preferredMoveRecalled: false,
        acceptedAlternative: true,
      })),
    ).toBe('hard');
  });

  it('grades a slow preferred recall Hard without a useful baseline', () => {
    expect(gradeReview(input({ decisionTimeMs: 7_000 }))).toBe('hard');
  });

  it('recognizes at least 20 percent personal speed improvement as Good', () => {
    expect(
      gradeReview(input({
        decisionTimeMs: 7_000,
        historicalAverageDecisionTimeMs: 9_000,
      })),
    ).toBe('good');
  });

  it('grades a clean preferred recall inside five seconds Good', () => {
    expect(gradeReview(input({ decisionTimeMs: 4_500 }))).toBe('good');
  });

  it('grades established clean recall at three seconds or faster Easy', () => {
    expect(
      gradeReview(input({
        decisionTimeMs: 2_500,
        priorScheduledReviews: 2,
      })),
    ).toBe('easy');
  });

  it('keeps fast recall Good until there is enough review history', () => {
    expect(
      gradeReview(input({
        decisionTimeMs: 2_500,
        priorScheduledReviews: 1,
      })),
    ).toBe('good');
  });
});
