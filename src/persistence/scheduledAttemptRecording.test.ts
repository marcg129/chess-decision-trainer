import 'fake-indexeddb/auto';
import { Chess } from 'chess.js';
import { describe, expect, test, vi } from 'vitest';
import { FsrsScheduler, type ScheduledReviewResult } from '../review/fsrsAdapter';
import type { ReviewAttemptMetadata } from '../review/types';
import type { Repertoire } from '../training/types';
import { createId } from '../training/types';
import type { DexieTrainingRepository as RepositoryType } from './dexieTrainingRepository';
import { ChessTrainingDatabase } from './db';
import { DexieTrainingRepository } from './dexieTrainingRepository';

const REVIEWED_AT = new Date('2026-10-02T12:00:00.000Z');

type ScheduledInput = {
  attemptId: string;
  timestamp: string;
  repertoireId: string;
  positionId: string;
  repertoireMoveId?: string;
  expectedMove: string;
  actualMove: string;
  correct: boolean;
  decisionTimeMs: number;
  hintCount: number;
  hintUsed: boolean;
  mode: string;
  review: ReviewAttemptMetadata;
  expectedTargetUpdatedAt: string | null;
  scheduledReview: ScheduledReviewResult | null;
};

type ScheduledRepository = RepositoryType & {
  recordScheduledAttempt(input: ScheduledInput): Promise<unknown>;
};

async function setup() {
  const db = new ChessTrainingDatabase(`scheduled-attempt-${crypto.randomUUID()}`);
  const repo = new DexieTrainingRepository(db);
  const learner = await repo.ensureLocalLearner();
  const now = '2026-10-02T11:00:00.000Z';
  const repertoire: Repertoire = {
    id: createId(),
    learnerId: learner.id,
    name: 'Scheduled attempts',
    side: 'white',
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await repo.saveRepertoire(repertoire);

  const preferred = await repo.upsertRepertoireTransition({
    repertoireId: repertoire.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2', to: 'e4' },
    role: 'learner',
    preferred: true,
    trainable: true,
    order: 0,
  });
  const alternative = await repo.upsertRepertoireTransition({
    repertoireId: repertoire.id,
    fromFen: new Chess().fen(),
    move: { from: 'd2', to: 'd4' },
    role: 'alternative',
    preferred: false,
    trainable: true,
    order: 1,
  });

  return {
    db,
    repo: repo as ScheduledRepository,
    repertoire,
    preferred,
    alternative,
  };
}

function scheduledReview(
  rating: ReviewAttemptMetadata['rating'],
  current: Parameters<FsrsScheduler['schedule']>[0] = null,
  reviewedAt = REVIEWED_AT,
): ScheduledReviewResult {
  return new FsrsScheduler().schedule(current, rating, reviewedAt);
}

function inputFor(
  context: Awaited<ReturnType<typeof setup>>,
  overrides: Partial<ScheduledInput> = {},
): ScheduledInput {
  const targetId = context.preferred.repertoireMove.id;
  return {
    attemptId: createId(),
    timestamp: REVIEWED_AT.toISOString(),
    repertoireId: context.repertoire.id,
    positionId: context.preferred.fromPosition.id,
    repertoireMoveId: targetId,
    expectedMove: context.preferred.moveEdge.moveKey,
    actualMove: context.preferred.moveEdge.moveKey,
    correct: true,
    decisionTimeMs: 1_800,
    hintCount: 0,
    hintUsed: false,
    mode: 'opening:review-due',
    review: {
      targetRepertoireMoveId: targetId,
      rating: 'good',
      kind: 'scheduled',
      schedulingApplied: true,
      newCard: true,
    },
    expectedTargetUpdatedAt: null,
    scheduledReview: scheduledReview('good'),
    ...overrides,
  };
}

describe('recordScheduledAttempt', () => {
  test('atomically records a new preferred-target review and its schedule', async () => {
    const context = await setup();
    const input = inputFor(context);

    const attempt = await context.repo.recordScheduledAttempt(input) as {
      id: string;
      review?: ReviewAttemptMetadata;
    };
    const mastery = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );

    expect(attempt.id).toBe(input.attemptId);
    expect(attempt.review).toEqual(input.review);
    expect(await context.db.trainingAttempts.count()).toBe(1);
    expect(mastery).toMatchObject({
      repertoireMoveId: context.preferred.repertoireMove.id,
      attempts: 1,
      correct: 1,
      nextReviewAt: input.scheduledReview?.nextReviewAt,
      schedulingData: input.scheduledReview?.schedulingData,
    });
    expect((await context.repo.getPositionMastery(context.preferred.fromPosition.id))?.attempts)
      .toBe(1);
    await context.db.delete();
  });

  test('records an accepted alternative as actual mastery while scheduling the preferred target', async () => {
    const context = await setup();
    const hard = scheduledReview('hard');
    const input = inputFor(context, {
      repertoireMoveId: context.alternative.repertoireMove.id,
      actualMove: context.alternative.moveEdge.moveKey,
      review: {
        targetRepertoireMoveId: context.preferred.repertoireMove.id,
        rating: 'hard',
        kind: 'scheduled',
        schedulingApplied: true,
        newCard: true,
      },
      scheduledReview: hard,
    });

    await context.repo.recordScheduledAttempt(input);

    const actualMastery = await context.repo.getRepertoireMoveMastery(
      context.alternative.repertoireMove.id,
    );
    const targetMastery = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );

    expect(actualMastery).toMatchObject({ attempts: 1, correct: 1 });
    expect(targetMastery).toMatchObject({
      attempts: 0,
      correct: 0,
      incorrect: 0,
      nextReviewAt: hard.nextReviewAt,
      schedulingData: hard.schedulingData,
    });
    await context.db.delete();
  });

  test('persists a corrected preferred move as an incorrect first recall and schedules Again', async () => {
    const context = await setup();
    const again = scheduledReview('again');
    const input = inputFor(context, {
      actualMove: 'g1f3',
      correct: false,
      decisionTimeMs: 6_000,
      review: {
        targetRepertoireMoveId: context.preferred.repertoireMove.id,
        rating: 'again',
        kind: 'scheduled',
        schedulingApplied: true,
        newCard: true,
      },
      scheduledReview: again,
    });

    const attempt = await context.repo.recordScheduledAttempt(input) as { correct: boolean };
    const mastery = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );

    expect(attempt.correct).toBe(false);
    expect(mastery).toMatchObject({
      attempts: 1,
      correct: 0,
      incorrect: 1,
      streak: 0,
      nextReviewAt: again.nextReviewAt,
      schedulingData: again.schedulingData,
    });
    await context.db.delete();
  });

  test('returns an existing stable attempt before stale-revision validation and never schedules twice', async () => {
    const context = await setup();
    const input = inputFor(context, {
      attemptId: '22222222-2222-4222-8222-222222222222',
    });

    const first = await context.repo.recordScheduledAttempt(input);
    const firstMastery = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );
    const second = await context.repo.recordScheduledAttempt(input);
    const secondMastery = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );

    expect(second).toEqual(first);
    expect(await context.db.trainingAttempts.count()).toBe(1);
    expect(secondMastery).toEqual(firstMastery);
    await context.db.delete();
  });

  test('rejects a different attempt based on a stale target mastery revision', async () => {
    const context = await setup();
    await context.repo.recordScheduledAttempt(inputFor(context));

    const stale = inputFor(context, {
      attemptId: createId(),
      expectedTargetUpdatedAt: null,
      review: {
        targetRepertoireMoveId: context.preferred.repertoireMove.id,
        rating: 'good',
        kind: 'scheduled',
        schedulingApplied: true,
        newCard: false,
      },
    });

    await expect(context.repo.recordScheduledAttempt(stale))
      .rejects.toMatchObject({ name: 'ReviewScheduleConflictError' });
    expect(await context.db.trainingAttempts.count()).toBe(1);
    await context.db.delete();
  });

  test('rolls back attempt and mastery writes when the schedule write fails', async () => {
    const context = await setup();
    const originalPut = context.db.repertoireMoveMastery.put.bind(
      context.db.repertoireMoveMastery,
    );
    const putSpy = vi.spyOn(context.db.repertoireMoveMastery, 'put')
      .mockImplementationOnce(async () => {
        throw new Error('simulated schedule write failure');
      })
      .mockImplementation(originalPut);

    await expect(context.repo.recordScheduledAttempt(inputFor(context))).rejects.toThrow(
      /simulated schedule write failure|transaction/i,
    );

    expect(await context.db.trainingAttempts.count()).toBe(0);
    expect(await context.db.positionMastery.count()).toBe(0);
    expect(await context.db.repertoireMoveMastery.count()).toBe(0);
    putSpy.mockRestore();
    await context.db.delete();
  });

  test('records relearning history and descriptive mastery without changing the target schedule', async () => {
    const context = await setup();
    await context.repo.recordScheduledAttempt(inputFor(context));
    const scheduledMastery = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );
    expect(scheduledMastery).toBeDefined();

    const relearning = inputFor(context, {
      attemptId: createId(),
      timestamp: '2026-10-02T12:03:00.000Z',
      expectedTargetUpdatedAt: scheduledMastery!.updatedAt,
      scheduledReview: null,
      review: {
        targetRepertoireMoveId: context.preferred.repertoireMove.id,
        rating: 'good',
        kind: 'relearning',
        schedulingApplied: false,
        newCard: false,
      },
    });

    await context.repo.recordScheduledAttempt(relearning);
    const after = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );

    expect(await context.db.trainingAttempts.count()).toBe(2);
    expect(after?.attempts).toBe(2);
    expect(after?.nextReviewAt).toBe(scheduledMastery?.nextReviewAt);
    expect(after?.schedulingData).toEqual(scheduledMastery?.schedulingData);
    await context.db.delete();
  });

  test('ordinary practice attempts preserve an existing Review Due schedule', async () => {
    const context = await setup();
    await context.repo.recordScheduledAttempt(inputFor(context));
    const scheduledMastery = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );

    await context.repo.recordAttempt({
      timestamp: '2026-10-02T13:00:00.000Z',
      repertoireId: context.repertoire.id,
      positionId: context.preferred.fromPosition.id,
      repertoireMoveId: context.preferred.repertoireMove.id,
      expectedMove: context.preferred.moveEdge.moveKey,
      actualMove: context.preferred.moveEdge.moveKey,
      correct: true,
      decisionTimeMs: 1_200,
      hintCount: 0,
      hintUsed: false,
      mode: 'opening:quick-recall',
    });

    const after = await context.repo.getRepertoireMoveMastery(
      context.preferred.repertoireMove.id,
    );
    expect(after?.attempts).toBe((scheduledMastery?.attempts ?? 0) + 1);
    expect(after?.nextReviewAt).toBe(scheduledMastery?.nextReviewAt);
    expect(after?.schedulingData).toEqual(scheduledMastery?.schedulingData);
    await context.db.delete();
  });
});
