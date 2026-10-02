import { describe, expect, it } from 'vitest';
import type {
  ReviewInventory,
  ReviewInventoryTarget,
} from '../training/repositories';
import type {
  MoveEdge,
  Position,
  Repertoire,
  RepertoireMove,
  RepertoireMoveMastery,
} from '../training/types';
import { buildReviewQueue } from './queue';

function target(input: {
  id: string;
  repertoireId: string;
  due?: string;
  depth?: number;
  sourceOrder?: number;
}): ReviewInventoryTarget {
  const repertoire: Repertoire = {
    id: input.repertoireId,
    learnerId: '00000000-0000-4000-8000-000000000001',
    name: input.repertoireId,
    side: 'white',
    archived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const position: Position = {
    id: `position-${input.id}`,
    positionKey: `key-${input.id}`,
    fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    sideToMove: 'w',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const toPosition: Position = {
    ...position,
    id: `to-${input.id}`,
    positionKey: `to-key-${input.id}`,
    fen: '8/8/8/8/8/8/K7/7k b - - 1 1',
    sideToMove: 'b',
  };
  const moveEdge: MoveEdge = {
    id: `edge-${input.id}`,
    fromPositionId: position.id,
    toPositionId: toPosition.id,
    moveKey: 'a1a2',
    from: 'a1',
    to: 'a2',
    san: 'Ka2',
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const repertoireMove: RepertoireMove = {
    id: input.id,
    repertoireId: input.repertoireId,
    moveEdgeId: moveEdge.id,
    role: 'learner',
    preferred: true,
    order: input.sourceOrder ?? 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const mastery: RepertoireMoveMastery | undefined = input.due
    ? {
        id: `mastery-${input.id}`,
        repertoireMoveId: repertoireMove.id,
        attempts: 1,
        correct: 1,
        incorrect: 0,
        streak: 1,
        averageDecisionTimeMs: 1500,
        lastAttemptedAt: '2026-09-30T00:00:00.000Z',
        state: 'new',
        score: 0,
        nextReviewAt: input.due,
        schedulingData: { kind: 'fsrs' },
        updatedAt: '2026-09-30T00:00:00.000Z',
      }
    : undefined;

  return {
    repertoire,
    position,
    preferred: { repertoireMove, moveEdge, toPosition },
    alternatives: [],
    ...(mastery ? { mastery } : {}),
    depth: input.depth ?? 0,
    sourceOrder: input.sourceOrder ?? 0,
    priorScheduledReviews: mastery ? 1 : 0,
  };
}

function plan(
  inventory: ReviewInventory,
  overrides: Partial<Parameters<typeof buildReviewQueue>[0]> = {},
) {
  return buildReviewQueue({
    inventory,
    settings: { newItemsPerDay: 10, batchSize: 15 },
    newIntroductionsToday: 0,
    ...overrides,
  });
}

describe('buildReviewQueue', () => {
  it('orders due cards by earliest nextReviewAt and always before new cards', () => {
    const inventory: ReviewInventory = {
      due: [
        target({ id: 'late', repertoireId: 'rep-a', due: '2026-10-01T11:00:00.000Z' }),
        target({ id: 'early', repertoireId: 'rep-b', due: '2026-10-01T08:00:00.000Z' }),
      ],
      newCandidates: [
        target({ id: 'new', repertoireId: 'rep-c' }),
      ],
    };

    expect(plan(inventory).cards.map((card) => card.target.preferred.repertoireMove.id))
      .toEqual(['early', 'late', 'new']);
    expect(plan(inventory).cards.map((card) => card.newCard))
      .toEqual([false, false, true]);
  });

  it('caps the initial unique targets at batch size without postponing backlog', () => {
    const inventory: ReviewInventory = {
      due: Array.from({ length: 65 }, (_, index) =>
        target({
          id: `due-${index.toString().padStart(2, '0')}`,
          repertoireId: 'rep-a',
          due: `2026-10-01T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
        })),
      newCandidates: [],
    };

    const result = plan(inventory, {
      settings: { newItemsPerDay: 10, batchSize: 15 },
    });
    expect(result.cards).toHaveLength(15);
    expect(result.remainingAfterBatch).toBe(50);
    expect(inventory.due).toHaveLength(65);
  });

  it('limits new cards by the remaining daily allowance', () => {
    const inventory: ReviewInventory = {
      due: [],
      newCandidates: Array.from({ length: 8 }, (_, index) =>
        target({ id: `new-${index}`, repertoireId: 'rep-a' })),
    };

    const result = plan(inventory, { newIntroductionsToday: 8 });
    expect(result.cards).toHaveLength(2);
    expect(result.cards.every((card) => card.newCard)).toBe(true);
    expect(result.newAvailable).toBe(2);
  });

  it('round-robins new cards across repertoires', () => {
    const inventory: ReviewInventory = {
      due: [],
      newCandidates: [
        target({ id: 'a1', repertoireId: 'rep-a', depth: 0, sourceOrder: 0 }),
        target({ id: 'a2', repertoireId: 'rep-a', depth: 1, sourceOrder: 1 }),
        target({ id: 'a3', repertoireId: 'rep-a', depth: 2, sourceOrder: 2 }),
        target({ id: 'b1', repertoireId: 'rep-b', depth: 0, sourceOrder: 0 }),
        target({ id: 'b2', repertoireId: 'rep-b', depth: 1, sourceOrder: 1 }),
      ],
    };

    const result = plan(inventory, {
      settings: { newItemsPerDay: 5, batchSize: 5 },
    });
    expect(result.cards.map((card) => card.target.preferred.repertoireMove.id))
      .toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
  });

  it('orders new cards within a repertoire by depth, source order, then stable id', () => {
    const inventory: ReviewInventory = {
      due: [],
      newCandidates: [
        target({ id: 'z', repertoireId: 'rep-a', depth: 1, sourceOrder: 0 }),
        target({ id: 'c', repertoireId: 'rep-a', depth: 0, sourceOrder: 1 }),
        target({ id: 'b', repertoireId: 'rep-a', depth: 0, sourceOrder: 0 }),
        target({ id: 'a', repertoireId: 'rep-a', depth: 0, sourceOrder: 0 }),
      ],
    };

    expect(plan(inventory).cards.map((card) => card.target.preferred.repertoireMove.id))
      .toEqual(['a', 'b', 'c', 'z']);
  });

  it('can filter the queue to one repertoire without mutating source inventory', () => {
    const inventory: ReviewInventory = {
      due: [
        target({ id: 'due-a', repertoireId: 'rep-a', due: '2026-10-01T08:00:00.000Z' }),
        target({ id: 'due-b', repertoireId: 'rep-b', due: '2026-10-01T08:00:00.000Z' }),
      ],
      newCandidates: [
        target({ id: 'new-a', repertoireId: 'rep-a' }),
        target({ id: 'new-b', repertoireId: 'rep-b' }),
      ],
    };

    const result = plan(inventory, { filterRepertoireId: 'rep-b' });
    expect(result.cards.map((card) => card.target.repertoire.id))
      .toEqual(['rep-b', 'rep-b']);
    expect(inventory.due).toHaveLength(2);
    expect(inventory.newCandidates).toHaveLength(2);
  });

  it('serves due cards when the configured new-item limit is zero', () => {
    const inventory: ReviewInventory = {
      due: [
        target({ id: 'due', repertoireId: 'rep-a', due: '2026-10-01T08:00:00.000Z' }),
      ],
      newCandidates: [
        target({ id: 'new', repertoireId: 'rep-a' }),
      ],
    };

    const result = plan(inventory, {
      settings: { newItemsPerDay: 0, batchSize: 15 },
    });
    expect(result.cards.map((card) => card.target.preferred.repertoireMove.id))
      .toEqual(['due']);
    expect(result.newAvailable).toBe(0);
  });
});
