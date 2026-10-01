import { describe, expect, it } from 'vitest';
import {
  FsrsScheduler,
  parseFsrsSchedulingEnvelope,
  type FsrsSchedulingEnvelopeV1,
} from './fsrsAdapter';
import type { ReviewRating } from './types';

const REVIEWED_AT = new Date('2026-10-01T12:00:00.000Z');

function scheduled(rating: ReviewRating = 'good') {
  return new FsrsScheduler().schedule(null, rating, REVIEWED_AT);
}

describe('FsrsScheduler', () => {
  it('schedules a new Good review into a versioned JSON-safe envelope', () => {
    const result = scheduled('good');

    expect(result.schedulingData.kind).toBe('fsrs');
    expect(result.schedulingData.schedulingSchemaVersion).toBe(1);
    expect(result.schedulingData.library).toEqual({
      name: 'ts-fsrs',
      major: 5,
    });
    expect(result.nextReviewAt).toBe(result.schedulingData.card.due);
    expect(Date.parse(result.nextReviewAt)).toBeGreaterThan(REVIEWED_AT.getTime());
    expect(result.schedulingData.card.lastReviewAt).toBe(REVIEWED_AT.toISOString());
    expect(result.schedulingData.card.learningSteps).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for the same card, rating, and timestamp', () => {
    const scheduler = new FsrsScheduler();
    const first = scheduler.schedule(null, 'good', REVIEWED_AT);
    const second = scheduler.schedule(null, 'good', REVIEWED_AT);

    expect(second).toEqual(first);

    const nextAt = new Date('2026-10-02T12:00:00.000Z');
    expect(
      scheduler.schedule(first.schedulingData, 'good', nextAt),
    ).toEqual(
      scheduler.schedule(first.schedulingData, 'good', nextAt),
    );
  });

  it('maps Again, Hard, Good, and Easy to increasingly longer new-card outcomes', () => {
    const outcomes = (['again', 'hard', 'good', 'easy'] as const)
      .map((rating) => scheduled(rating));

    const due = outcomes.map((result) => Date.parse(result.nextReviewAt));
    expect(due[0]).toBeLessThan(due[1]);
    expect(due[1]).toBeLessThanOrEqual(due[2]);
    expect(due[2]).toBeLessThan(due[3]);
  });

  it('round-trips a serialized scheduling envelope', () => {
    const envelope = scheduled().schedulingData;
    const serialized = JSON.parse(JSON.stringify(envelope)) as unknown;

    expect(parseFsrsSchedulingEnvelope(serialized)).toEqual(envelope);
  });
});

describe('parseFsrsSchedulingEnvelope', () => {
  function valid(): FsrsSchedulingEnvelopeV1 {
    return scheduled().schedulingData;
  }

  it('rejects unsupported scheduling schema versions', () => {
    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      schedulingSchemaVersion: 2,
    })).toThrow(/schema/i);
  });

  it('rejects unsupported ts-fsrs major versions', () => {
    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      library: { name: 'ts-fsrs', major: 6 },
    })).toThrow(/library|major|version/i);
  });

  it('rejects invalid card states', () => {
    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      card: { ...valid().card, state: 'forgotten' },
    })).toThrow(/state/i);
  });

  it('rejects non-finite or negative scheduling numbers', () => {
    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      card: { ...valid().card, stability: Number.NaN },
    })).toThrow(/stability|number/i);

    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      card: { ...valid().card, reps: -1 },
    })).toThrow(/reps|number/i);

    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      card: { ...valid().card, learningSteps: -1 },
    })).toThrow(/learning|number/i);
  });

  it('rejects malformed due and last-review timestamps', () => {
    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      card: { ...valid().card, due: 'tomorrow sometime' },
    })).toThrow(/due|date|time/i);

    expect(() => parseFsrsSchedulingEnvelope({
      ...valid(),
      card: { ...valid().card, lastReviewAt: 'yesterday' },
    })).toThrow(/review|date|time/i);
  });
});
