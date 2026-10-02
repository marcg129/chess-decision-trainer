import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
import { deriveTransition } from '../training/graph';
import type {
  RecordScheduledAttemptInput,
  TrainingRepository,
} from '../training/repositories';
import {
  createId,
  type Position,
  type Repertoire,
  type RepertoireMove,
} from '../training/types';
import { FsrsScheduler } from './fsrsAdapter';
import { ReviewTrainingEngine } from './engine';
import type { ReviewCard, ReviewSessionPlan } from './queue';

function makeCard(input: {
  id: string;
  repertoireName: string;
  side: 'white' | 'black';
  newCard?: boolean;
  averageDecisionTimeMs?: number | null;
  priorScheduledReviews?: number;
  alternative?: boolean;
}): ReviewCard {
  const fromFen = input.side === 'white'
    ? new Chess().fen()
    : (() => {
        const chess = new Chess();
        chess.move({ from: 'e2', to: 'e4' });
        return chess.fen();
      })();
  const preferredMove = input.side === 'white'
    ? { from: 'e2' as const, to: 'e4' as const }
    : { from: 'c7' as const, to: 'c5' as const };
  const preferredTransition = deriveTransition(fromFen, preferredMove);
  const position: Position = {
    id: `position-${input.id}`,
    positionKey: preferredTransition.fromPositionKey,
    fen: fromFen,
    sideToMove: input.side === 'white' ? 'w' : 'b',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  };
  const toPosition: Position = {
    id: `to-${input.id}`,
    positionKey: preferredTransition.toPositionKey,
    fen: preferredTransition.toFen,
    sideToMove: input.side === 'white' ? 'b' : 'w',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  };
  const repertoire: Repertoire = {
    id: `rep-${input.id}`,
    learnerId: '00000000-0000-4000-8000-000000000001',
    name: input.repertoireName,
    side: input.side,
    archived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const preferredRepertoireMove: RepertoireMove = {
    id: `preferred-${input.id}`,
    repertoireId: repertoire.id,
    moveEdgeId: `preferred-edge-${input.id}`,
    role: 'learner',
    preferred: true,
    order: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const preferred = {
    repertoireMove: preferredRepertoireMove,
    moveEdge: {
      id: preferredRepertoireMove.moveEdgeId,
      fromPositionId: position.id,
      toPositionId: toPosition.id,
      moveKey: preferredTransition.moveKey,
      from: preferredTransition.from,
      to: preferredTransition.to,
      promotion: preferredTransition.promotion,
      san: preferredTransition.san,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    toPosition,
  };

  const alternatives = [];
  if (input.alternative && input.side === 'white') {
    const transition = deriveTransition(fromFen, { from: 'd2', to: 'd4' });
    const alternativeTo: Position = {
      id: `alternative-to-${input.id}`,
      positionKey: transition.toPositionKey,
      fen: transition.toFen,
      sideToMove: 'b',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    alternatives.push({
      repertoireMove: {
        id: `alternative-${input.id}`,
        repertoireId: repertoire.id,
        moveEdgeId: `alternative-edge-${input.id}`,
        role: 'alternative' as const,
        preferred: false,
        order: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      moveEdge: {
        id: `alternative-edge-${input.id}`,
        fromPositionId: position.id,
        toPositionId: alternativeTo.id,
        moveKey: transition.moveKey,
        from: transition.from,
        to: transition.to,
        promotion: transition.promotion,
        san: transition.san,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      toPosition: alternativeTo,
    });
  }

  const existingSchedule = input.newCard === false
    ? new FsrsScheduler().schedule(
        null,
        'good',
        new Date('2026-09-25T12:00:00.000Z'),
      )
    : null;

  return {
    target: {
      repertoire,
      position,
      preferred,
      alternatives,
      ...(existingSchedule
        ? {
            mastery: {
              id: `mastery-${input.id}`,
              repertoireMoveId: preferredRepertoireMove.id,
              attempts: 2,
              correct: 2,
              incorrect: 0,
              streak: 2,
              averageDecisionTimeMs: input.averageDecisionTimeMs ?? 4_000,
              lastAttemptedAt: '2026-09-25T12:00:00.000Z',
              state: 'new',
              score: 0,
              nextReviewAt: existingSchedule.nextReviewAt,
              schedulingData: existingSchedule.schedulingData,
              updatedAt: '2026-09-25T12:00:00.000Z',
            },
          }
        : {}),
      depth: 0,
      sourceOrder: 0,
      priorScheduledReviews: input.priorScheduledReviews ?? (existingSchedule ? 2 : 0),
    },
    newCard: input.newCard ?? true,
  };
}

function plan(cards: ReviewCard[], remainingAfterBatch = 0): ReviewSessionPlan {
  return {
    cards,
    remainingAfterBatch,
    newAvailable: cards.filter((card) => card.newCard).length,
    settings: { newItemsPerDay: 10, batchSize: 15 },
  };
}

function setup(cards: ReviewCard[], options: {
  nowMs?: { value: number };
  nowDate?: { value: Date };
  recordImpl?: (input: RecordScheduledAttemptInput) => Promise<unknown>;
  remainingAfterBatch?: number;
} = {}) {
  const nowMs = options.nowMs ?? { value: 1_000 };
  const nowDate = options.nowDate ?? { value: new Date('2026-10-02T12:00:00.000Z') };
  const recordScheduledAttempt = vi.fn(
    options.recordImpl
      ?? (async (input: RecordScheduledAttemptInput) => ({
        ...input,
        id: input.attemptId,
        masteryBefore: { positionState: 'new', positionScore: 0 },
        masteryAfter: { positionState: 'new', positionScore: 0 },
      })),
  );
  const repository = {
    createSession: vi.fn().mockResolvedValue(undefined),
    completeSession: vi.fn().mockResolvedValue(undefined),
    recordScheduledAttempt,
  } as unknown as TrainingRepository;

  return {
    nowMs,
    nowDate,
    repository,
    recordScheduledAttempt,
    start: () => ReviewTrainingEngine.start({
      plan: plan(cards, options.remainingAfterBatch ?? 0),
      repository,
      nowMs: () => nowMs.value,
      nowDate: () => new Date(nowDate.value),
    }),
  };
}

describe('ReviewTrainingEngine core behavior', () => {
  it('moves across mixed White and Black repertoires with the correct orientation metadata', async () => {
    const white = makeCard({ id: 'white', repertoireName: 'Italian', side: 'white' });
    const black = makeCard({ id: 'black', repertoireName: 'Sicilian', side: 'black' });
    const context = setup([white, black]);
    const engine = await context.start();

    expect(engine.state()).toMatchObject({
      repertoireName: 'Italian',
      learnerSide: 'w',
      progress: { completed: 0, total: 2 },
    });

    context.nowMs.value = 2_000;
    await engine.submitMove({ from: 'e2', to: 'e4' });

    expect(engine.state()).toMatchObject({
      repertoireName: 'Sicilian',
      learnerSide: 'b',
      progress: { completed: 1, total: 2 },
    });
  });

  it('grades and schedules a clean preferred response automatically', async () => {
    const card = makeCard({
      id: 'preferred',
      repertoireName: 'Italian',
      side: 'white',
      newCard: false,
      priorScheduledReviews: 2,
    });
    const context = setup([card]);
    const engine = await context.start();

    context.nowMs.value = 3_500;
    await engine.submitMove({ from: 'e2', to: 'e4' });

    expect(context.recordScheduledAttempt).toHaveBeenCalledTimes(1);
    const saved = context.recordScheduledAttempt.mock.calls[0][0];
    expect(saved.review).toMatchObject({
      targetRepertoireMoveId: 'preferred-preferred',
      rating: 'easy',
      kind: 'scheduled',
      schedulingApplied: true,
      newCard: false,
    });
    expect(saved.scheduledReview?.nextReviewAt).toBeTruthy();
    expect(engine.state().complete).toBe(true);
  });

  it('accepts an alternative immediately but grades the preferred target Hard', async () => {
    const card = makeCard({
      id: 'alternative',
      repertoireName: 'Queen pawn',
      side: 'white',
      alternative: true,
    });
    const context = setup([card]);
    const engine = await context.start();

    context.nowMs.value = 2_000;
    await engine.submitMove({ from: 'd2', to: 'd4' });

    const saved = context.recordScheduledAttempt.mock.calls[0][0];
    expect(saved.repertoireMoveId).toBe('alternative-alternative');
    expect(saved.review).toMatchObject({
      targetRepertoireMoveId: 'preferred-alternative',
      rating: 'hard',
    });
    expect(saved.correct).toBe(true);
  });

  it('grades the first wrong response Again and requires the preferred move before persistence', async () => {
    const card = makeCard({ id: 'wrong', repertoireName: 'Italian', side: 'white' });
    const context = setup([card]);
    const engine = await context.start();

    context.nowMs.value = 4_000;
    let state = await engine.submitMove({ from: 'g1', to: 'f3' });
    expect(state.phase).toBe('retry');
    expect(context.recordScheduledAttempt).not.toHaveBeenCalled();

    state = await engine.submitMove({ from: 'e2', to: 'e4' });
    expect(context.recordScheduledAttempt).toHaveBeenCalledTimes(1);
    const saved = context.recordScheduledAttempt.mock.calls[0][0];
    expect(saved).toMatchObject({
      actualMove: 'g1f3',
      correct: false,
      repertoireMoveId: 'preferred-wrong',
      review: {
        rating: 'again',
        targetRepertoireMoveId: 'preferred-wrong',
        schedulingApplied: true,
      },
    });
    expect(state.complete).toBe(true);
  });

  it('grades hint-assisted preferred recall Again', async () => {
    const card = makeCard({ id: 'hint', repertoireName: 'Italian', side: 'white' });
    const context = setup([card]);
    const engine = await context.start();

    expect(engine.requestHint().hintCount).toBe(1);
    context.nowMs.value = 2_000;
    await engine.submitMove({ from: 'e2', to: 'e4' });

    expect(context.recordScheduledAttempt.mock.calls[0][0].review.rating).toBe('again');
  });

  it('holds a resolved prompt on persistence failure and retries with the same stable attempt id', async () => {
    const card = makeCard({ id: 'retry', repertoireName: 'Italian', side: 'white' });
    let calls = 0;
    const context = setup([card], {
      recordImpl: async (input) => {
        calls += 1;
        if (calls === 1) throw new Error('storage unavailable');
        return {
          ...input,
          id: input.attemptId,
          masteryBefore: { positionState: 'new', positionScore: 0 },
          masteryAfter: { positionState: 'new', positionScore: 0 },
        };
      },
    });
    const engine = await context.start();

    context.nowMs.value = 2_000;
    let state = await engine.submitMove({ from: 'e2', to: 'e4' });
    expect(state.phase).toBe('resolved-not-persisted');
    const firstId = context.recordScheduledAttempt.mock.calls[0][0].attemptId;

    state = await engine.retryPersistence();
    expect(context.recordScheduledAttempt).toHaveBeenCalledTimes(2);
    expect(context.recordScheduledAttempt.mock.calls[1][0].attemptId).toBe(firstId);
    expect(state.complete).toBe(true);
  });
});

describe('ReviewTrainingEngine same-session relearning', () => {
  it('reintroduces an Again card only after three intervening prompts and 120 seconds', async () => {
    const cards = ['failed', 'two', 'three', 'four'].map((id) =>
      makeCard({ id, repertoireName: id, side: 'white' }));
    const context = setup(cards);
    const engine = await context.start();

    context.nowMs.value = 2_000;
    await engine.submitMove({ from: 'g1', to: 'f3' });
    await engine.submitMove({ from: 'e2', to: 'e4' });

    for (const nextMs of [40_000, 80_000]) {
      context.nowMs.value = nextMs;
      await engine.submitMove({ from: 'e2', to: 'e4' });
      expect(engine.state().relearning).toBe(false);
    }

    context.nowMs.value = 123_000;
    await engine.submitMove({ from: 'e2', to: 'e4' });
    expect(engine.state()).toMatchObject({
      repertoireName: 'failed',
      relearning: true,
      complete: false,
    });

    context.nowMs.value = 124_000;
    await engine.submitMove({ from: 'e2', to: 'e4' });
    const saved = context.recordScheduledAttempt.mock.calls.at(-1)?.[0];
    expect(saved?.review).toMatchObject({
      kind: 'relearning',
      schedulingApplied: false,
      newCard: false,
    });
    expect(saved?.scheduledReview).toBeNull();
    expect(engine.state().complete).toBe(true);
  });

  it('does not repeat a failed card immediately when the unique batch ends before relearning is eligible', async () => {
    const card = makeCard({ id: 'short', repertoireName: 'Short', side: 'white' });
    const context = setup([card]);
    const engine = await context.start();

    context.nowMs.value = 2_000;
    await engine.submitMove({ from: 'g1', to: 'f3' });
    const state = await engine.submitMove({ from: 'e2', to: 'e4' });

    expect(state.complete).toBe(true);
    expect(state.progress).toEqual({ completed: 1, total: 1 });
    expect(context.recordScheduledAttempt).toHaveBeenCalledTimes(1);
  });

  it('does not replace the original Again schedule after successful delayed relearning', async () => {
    const cards = ['failed', 'two', 'three', 'four'].map((id) =>
      makeCard({ id, repertoireName: id, side: 'white' }));
    const context = setup(cards);
    const engine = await context.start();

    context.nowMs.value = 2_000;
    await engine.submitMove({ from: 'g1', to: 'f3' });
    await engine.submitMove({ from: 'e2', to: 'e4' });
    const original = context.recordScheduledAttempt.mock.calls[0][0];
    expect(original.review.rating).toBe('again');
    expect(original.scheduledReview).not.toBeNull();

    for (const nextMs of [40_000, 80_000, 123_000]) {
      context.nowMs.value = nextMs;
      await engine.submitMove({ from: 'e2', to: 'e4' });
    }

    context.nowMs.value = 124_000;
    await engine.submitMove({ from: 'e2', to: 'e4' });
    const relearning = context.recordScheduledAttempt.mock.calls.at(-1)?.[0];
    expect(relearning?.review.kind).toBe('relearning');
    expect(relearning?.scheduledReview).toBeNull();
  });
});
