import { describe, expect, it, vi } from 'vitest';
import type { ReviewInventory, ReviewInventoryTarget } from '../training/repositories';
import type { LearnerProfile } from '../training/types';
import type { ReviewSettings } from '../review/types';
import { ReviewTrainingService } from './reviewTrainingService';

function learner(settings?: ReviewSettings): LearnerProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Local learner',
    ...(settings ? { reviewSettings: settings } : {}),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function target(id: string, repertoireId: string, due?: string): ReviewInventoryTarget {
  return {
    repertoire: {
      id: repertoireId,
      learnerId: '00000000-0000-4000-8000-000000000001',
      name: repertoireId,
      side: 'white',
      archived: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    position: {
      id: `position-${id}`,
      positionKey: `key-${id}`,
      fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
      sideToMove: 'w',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    preferred: {
      repertoireMove: {
        id,
        repertoireId,
        moveEdgeId: `edge-${id}`,
        role: 'learner',
        preferred: true,
        order: 0,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      moveEdge: {
        id: `edge-${id}`,
        fromPositionId: `position-${id}`,
        toPositionId: `to-${id}`,
        moveKey: 'a1a2',
        from: 'a1',
        to: 'a2',
        san: 'Ka2',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      toPosition: {
        id: `to-${id}`,
        positionKey: `to-key-${id}`,
        fen: '8/8/8/8/8/8/K7/7k b - - 1 1',
        sideToMove: 'b',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    },
    alternatives: [],
    ...(due
      ? {
          mastery: {
            id: `mastery-${id}`,
            repertoireMoveId: id,
            attempts: 1,
            correct: 1,
            incorrect: 0,
            streak: 1,
            averageDecisionTimeMs: 1500,
            lastAttemptedAt: '2026-10-01T00:00:00.000Z',
            state: 'new' as const,
            score: 0,
            nextReviewAt: due,
            schedulingData: { kind: 'fsrs' },
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        }
      : {}),
    depth: 0,
    sourceOrder: 0,
    priorScheduledReviews: due ? 1 : 0,
  };
}

function setup(input: {
  inventory?: ReviewInventory;
  settings?: ReviewSettings;
  introductions?: number;
  now?: Date;
  dayBounds?: (now: Date) => { startIso: string; endIso: string };
} = {}) {
  const inventory = input.inventory ?? { due: [], newCandidates: [] };
  const currentLearner = learner(input.settings);
  const training = {
    ensureLocalLearner: vi.fn().mockResolvedValue(currentLearner),
    loadReviewInventory: vi.fn().mockResolvedValue(inventory),
    countNewReviewIntroductions: vi.fn().mockResolvedValue(input.introductions ?? 0),
    updateReviewSettings: vi.fn().mockImplementation(async (settings: ReviewSettings) => ({
      ...currentLearner,
      reviewSettings: settings,
    })),
  };
  const now = input.now ?? new Date('2026-10-02T12:00:00.000Z');
  const service = new ReviewTrainingService(training, {
    now: () => new Date(now),
    ...(input.dayBounds ? { localDayBounds: input.dayBounds } : {}),
  });
  return { service, training };
}

describe('ReviewTrainingService', () => {
  it('reports due and daily-eligible new inventory with resolved settings', async () => {
    const { service } = setup({
      inventory: {
        due: [target('due', 'rep-a', '2026-10-02T08:00:00.000Z')],
        newCandidates: [
          target('new-a', 'rep-a'),
          target('new-b', 'rep-b'),
          target('new-c', 'rep-c'),
        ],
      },
      settings: { newItemsPerDay: 2, batchSize: 15 },
      introductions: 1,
    });

    await expect(service.getOverview()).resolves.toEqual({
      dueCount: 1,
      newAvailable: 1,
      settings: { newItemsPerDay: 2, batchSize: 15 },
    });
  });

  it('uses injected local-day bounds for durable new-card accounting', async () => {
    const dayBounds = vi.fn()
      .mockReturnValueOnce({
        startIso: '2026-10-02T04:00:00.000Z',
        endIso: '2026-10-03T04:00:00.000Z',
      })
      .mockReturnValueOnce({
        startIso: '2026-10-03T04:00:00.000Z',
        endIso: '2026-10-04T04:00:00.000Z',
      });
    const { service, training } = setup({ dayBounds });

    await service.getOverview();
    await service.getOverview();

    expect(training.countNewReviewIntroductions).toHaveBeenNthCalledWith(
      1,
      '2026-10-02T04:00:00.000Z',
      '2026-10-03T04:00:00.000Z',
    );
    expect(training.countNewReviewIntroductions).toHaveBeenNthCalledWith(
      2,
      '2026-10-03T04:00:00.000Z',
      '2026-10-04T04:00:00.000Z',
    );
  });

  it('normalizes and persists review settings', async () => {
    const { service, training } = setup();

    await expect(service.updateSettings({
      newItemsPerDay: 7,
      batchSize: 20,
    })).resolves.toEqual({
      newItemsPerDay: 7,
      batchSize: 20,
    });
    expect(training.updateReviewSettings).toHaveBeenCalledWith({
      newItemsPerDay: 7,
      batchSize: 20,
    });
    await expect(service.updateSettings({
      newItemsPerDay: 101,
      batchSize: 20,
    })).rejects.toThrow(/new items/i);
  });

  it('creates a deterministic global or filtered session plan without scheduling writes', async () => {
    const inventory: ReviewInventory = {
      due: [
        target('due-a', 'rep-a', '2026-10-02T08:00:00.000Z'),
        target('due-b', 'rep-b', '2026-10-02T09:00:00.000Z'),
      ],
      newCandidates: [
        target('new-a', 'rep-a'),
        target('new-b', 'rep-b'),
      ],
    };
    const { service, training } = setup({
      inventory,
      settings: { newItemsPerDay: 10, batchSize: 15 },
    });

    const globalPlan = await service.createSessionPlan();
    expect(globalPlan.cards.map((card) => card.target.preferred.repertoireMove.id))
      .toEqual(['due-a', 'due-b', 'new-a', 'new-b']);

    const filteredPlan = await service.createSessionPlan({ repertoireId: 'rep-b' });
    expect(filteredPlan.cards.map((card) => card.target.repertoire.id))
      .toEqual(['rep-b', 'rep-b']);
    expect(training.loadReviewInventory).toHaveBeenLastCalledWith({
      dueThroughIso: '2026-10-02T12:00:00.000Z',
      filterRepertoireId: 'rep-b',
    });
  });
});
