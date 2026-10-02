import { Chess } from 'chess.js';
import { describe, expect, it, vi } from 'vitest';
import { deriveTransition } from '../training/graph';
import type { RecordScheduledAttemptInput, TrainingRepository } from '../training/repositories';
import type { Position, Repertoire, RepertoireMove } from '../training/types';
import { ReviewTrainingEngine } from './engine';
import type { ReviewSessionPlan } from './queue';

function oneCardPlan(): ReviewSessionPlan {
  const fromFen = new Chess().fen();
  const transition = deriveTransition(fromFen, { from: 'e2', to: 'e4' });
  const repertoire: Repertoire = {
    id: 'rep-concurrent',
    learnerId: '00000000-0000-4000-8000-000000000001',
    name: 'Concurrent',
    side: 'white',
    archived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const position: Position = {
    id: 'position-concurrent',
    positionKey: transition.fromPositionKey,
    fen: fromFen,
    sideToMove: 'w',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const toPosition: Position = {
    id: 'to-concurrent',
    positionKey: transition.toPositionKey,
    fen: transition.toFen,
    sideToMove: 'b',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const repertoireMove: RepertoireMove = {
    id: 'move-concurrent',
    repertoireId: repertoire.id,
    moveEdgeId: 'edge-concurrent',
    role: 'learner',
    preferred: true,
    order: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  return {
    cards: [{
      newCard: true,
      target: {
        repertoire,
        position,
        preferred: {
          repertoireMove,
          moveEdge: {
            id: 'edge-concurrent',
            fromPositionId: position.id,
            toPositionId: toPosition.id,
            moveKey: transition.moveKey,
            from: transition.from,
            to: transition.to,
            promotion: transition.promotion,
            san: transition.san,
            createdAt: '2026-10-01T00:00:00.000Z',
          },
          toPosition,
        },
        alternatives: [],
        depth: 0,
        sourceOrder: 0,
        priorScheduledReviews: 0,
      },
    }],
    remainingAfterBatch: 0,
    newAvailable: 1,
    settings: { newItemsPerDay: 10, batchSize: 15 },
  };
}

describe('ReviewTrainingEngine concurrent persistence', () => {
  it('does not submit the same resolved prompt twice while persistence is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recordScheduledAttempt = vi.fn(async (input: RecordScheduledAttemptInput) => {
      await gate;
      return {
        ...input,
        id: input.attemptId,
        masteryBefore: { positionState: 'new' as const, positionScore: 0 },
        masteryAfter: { positionState: 'new' as const, positionScore: 0 },
      };
    });
    const repository = {
      createSession: vi.fn().mockResolvedValue(undefined),
      completeSession: vi.fn().mockResolvedValue(undefined),
      recordScheduledAttempt,
    } as unknown as TrainingRepository;

    const engine = await ReviewTrainingEngine.start({
      plan: oneCardPlan(),
      repository,
      nowMs: () => 2_000,
      nowDate: () => new Date('2026-10-02T12:00:00.000Z'),
    });

    const first = engine.submitMove({ from: 'e2', to: 'e4' });
    const second = engine.submitMove({ from: 'e2', to: 'e4' });

    expect(recordScheduledAttempt).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(recordScheduledAttempt).toHaveBeenCalledTimes(1);
  });
});
