import {
  nextPositionMastery,
  nextRepertoireMoveMastery,
  updateAverage,
} from './mastery';

test('updates running average deterministically', () => {
  expect(updateAverage(null, 0, 1200)).toBe(1200);
  expect(updateAverage(1200, 1, 2400)).toBe(1800);
});

test('updates shared position mastery counts and speed without scheduling changes', () => {
  const first = nextPositionMastery(undefined, 'position-1', {
    correct: true,
    decisionTimeMs: 1200,
  }, '2026-09-17T00:00:00.000Z');
  const second = nextPositionMastery(first, 'position-1', {
    correct: false,
    decisionTimeMs: 2400,
  }, '2026-09-17T00:01:00.000Z');

  expect(second.attempts).toBe(2);
  expect(second.correct).toBe(1);
  expect(second.incorrect).toBe(1);
  expect(second.averageDecisionTimeMs).toBe(1800);
  expect(second.lastSeenAt).toBe('2026-09-17T00:01:00.000Z');
  expect(second.state).toBe('new');
  expect(second.score).toBe(0);
  expect(second.nextReviewAt).toBeNull();
});

test('updates repertoire move streak independently from shared position mastery', () => {
  const first = nextRepertoireMoveMastery(undefined, 'move-1', {
    correct: true,
    decisionTimeMs: 1200,
  }, '2026-09-17T00:00:00.000Z');
  const second = nextRepertoireMoveMastery(first, 'move-1', {
    correct: true,
    decisionTimeMs: 1800,
  }, '2026-09-17T00:01:00.000Z');
  const third = nextRepertoireMoveMastery(second, 'move-1', {
    correct: false,
    decisionTimeMs: 2400,
  }, '2026-09-17T00:02:00.000Z');

  expect(third.attempts).toBe(3);
  expect(third.correct).toBe(2);
  expect(third.incorrect).toBe(1);
  expect(third.streak).toBe(0);
  expect(third.averageDecisionTimeMs).toBe(1800);
  expect(third.lastAttemptedAt).toBe('2026-09-17T00:02:00.000Z');
  expect(third.state).toBe('new');
  expect(third.score).toBe(0);
});
