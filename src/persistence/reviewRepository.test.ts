import 'fake-indexeddb/auto';
import { Chess } from 'chess.js';
import { normalizeReviewSettings } from '../review/settings';
import { createId, type Repertoire, type TrainingAttempt } from '../training/types';
import { ChessTrainingDatabase } from './db';
import { DexieTrainingRepository } from './dexieTrainingRepository';

const DUE_THROUGH = '2026-10-01T12:00:00.000Z';

async function setup() {
  const db = new ChessTrainingDatabase(`review-${crypto.randomUUID()}`);
  const repo = new DexieTrainingRepository(db);
  const learner = await repo.ensureLocalLearner();
  return { db, repo, learner };
}

function repertoire(
  learnerId: string,
  name: string,
  archived = false,
): Repertoire {
  const now = '2026-10-01T00:00:00.000Z';
  return {
    id: createId(),
    learnerId,
    name,
    side: 'white',
    archived,
    createdAt: now,
    updatedAt: now,
  };
}

async function addTarget(
  repo: DexieTrainingRepository,
  item: Repertoire,
  preferred = true,
) {
  await repo.saveRepertoire(item);
  return repo.upsertRepertoireTransition({
    repertoireId: item.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2', to: 'e4' },
    role: 'learner',
    preferred,
    trainable: true,
    order: 0,
  });
}

function directAttempt(overrides: Partial<TrainingAttempt>): TrainingAttempt {
  const now = '2026-10-01T10:00:00.000Z';
  return {
    id: createId(),
    timestamp: now,
    repertoireId: 'rep',
    positionId: 'position',
    expectedMove: 'e2e4',
    actualMove: 'e2e4',
    correct: true,
    decisionTimeMs: 1000,
    hintCount: 0,
    hintUsed: false,
    mode: 'opening:review-due',
    masteryBefore: { positionState: 'new', positionScore: 0 },
    masteryAfter: { positionState: 'new', positionScore: 0 },
    ...overrides,
  };
}

describe('review settings persistence', () => {
  it('uses defaults for an existing learner with no saved review settings', async () => {
    const { db, repo } = await setup();
    const learner = await repo.ensureLocalLearner();

    expect(normalizeReviewSettings(learner.reviewSettings)).toEqual({
      newItemsPerDay: 10,
      batchSize: 15,
    });
    await db.delete();
  });

  it('persists normalized review settings on the local learner', async () => {
    const { db, repo } = await setup();

    const updated = await repo.updateReviewSettings({
      newItemsPerDay: 7,
      batchSize: 20,
    });

    expect(updated.reviewSettings).toEqual({
      newItemsPerDay: 7,
      batchSize: 20,
    });
    expect((await repo.ensureLocalLearner()).reviewSettings).toEqual(updated.reviewSettings);
    await db.delete();
  });
});

describe('review inventory', () => {
  it('returns one preferred target with accepted alternatives and excludes archived repertoires', async () => {
    const { db, repo, learner } = await setup();
    const active = repertoire(learner.id, 'Active');
    const archived = repertoire(learner.id, 'Archived', true);
    const preferred = await addTarget(repo, active);

    const alternative = await repo.upsertRepertoireTransition({
      repertoireId: active.id,
      fromFen: new Chess().fen(),
      move: { from: 'd2', to: 'd4' },
      role: 'alternative',
      preferred: false,
      trainable: true,
      order: 1,
    });
    await addTarget(repo, archived);

    const inventory = await repo.loadReviewInventory({ dueThroughIso: DUE_THROUGH });

    expect(inventory.due).toEqual([]);
    expect(inventory.newCandidates).toHaveLength(1);
    expect(inventory.newCandidates[0]).toMatchObject({
      repertoire: { id: active.id, name: 'Active' },
      position: { id: preferred.fromPosition.id },
      preferred: {
        repertoireMove: { id: preferred.repertoireMove.id, preferred: true },
        moveEdge: { id: preferred.moveEdge.id },
      },
      depth: 0,
      sourceOrder: 0,
      priorScheduledReviews: 0,
    });
    expect(
      inventory.newCandidates[0].alternatives.map((choice) => choice.repertoireMove.id),
    ).toEqual([alternative.repertoireMove.id]);
    await db.delete();
  });

  it('rejects trainable positions without exactly one preferred learner move', async () => {
    const { db, repo, learner } = await setup();
    const none = repertoire(learner.id, 'No preferred');
    await addTarget(repo, none, false);

    await expect(
      repo.loadReviewInventory({ dueThroughIso: DUE_THROUGH }),
    ).rejects.toThrow(/exactly one preferred/i);

    await db.delete();
  });

  it('rejects trainable positions with multiple preferred learner moves', async () => {
    const { db, repo, learner } = await setup();
    const item = repertoire(learner.id, 'Two preferred');
    await addTarget(repo, item, true);
    await repo.upsertRepertoireTransition({
      repertoireId: item.id,
      fromFen: new Chess().fen(),
      move: { from: 'd2', to: 'd4' },
      role: 'learner',
      preferred: true,
      trainable: true,
      order: 1,
    });

    await expect(
      repo.loadReviewInventory({ dueThroughIso: DUE_THROUGH }),
    ).rejects.toThrow(/exactly one preferred/i);

    await db.delete();
  });

  it('separates due scheduled targets from unscheduled new candidates', async () => {
    const { db, repo, learner } = await setup();
    const dueRep = repertoire(learner.id, 'Due');
    const newRep = repertoire(learner.id, 'New');
    const futureRep = repertoire(learner.id, 'Future');
    const due = await addTarget(repo, dueRep);
    const fresh = await addTarget(repo, newRep);
    const future = await addTarget(repo, futureRep);

    const baseMastery = {
      attempts: 1,
      correct: 1,
      incorrect: 0,
      streak: 1,
      averageDecisionTimeMs: 1000,
      lastAttemptedAt: '2026-09-30T10:00:00.000Z',
      state: 'new' as const,
      score: 0,
      schedulingData: { kind: 'fsrs' },
      updatedAt: '2026-09-30T10:00:00.000Z',
    };
    await db.repertoireMoveMastery.bulkAdd([
      {
        id: createId(),
        repertoireMoveId: due.repertoireMove.id,
        nextReviewAt: '2026-10-01T09:00:00.000Z',
        ...baseMastery,
      },
      {
        id: createId(),
        repertoireMoveId: future.repertoireMove.id,
        nextReviewAt: '2026-10-02T09:00:00.000Z',
        ...baseMastery,
      },
    ]);

    const inventory = await repo.loadReviewInventory({ dueThroughIso: DUE_THROUGH });

    expect(inventory.due.map((target) => target.preferred.repertoireMove.id))
      .toEqual([due.repertoireMove.id]);
    expect(inventory.newCandidates.map((target) => target.preferred.repertoireMove.id))
      .toEqual([fresh.repertoireMove.id]);
    await db.delete();
  });

  it('counts only scheduling-applied reviews toward prior scheduled history', async () => {
    const { db, repo, learner } = await setup();
    const item = repertoire(learner.id, 'History');
    const target = await addTarget(repo, item);
    const base = {
      repertoireId: item.id,
      positionId: target.fromPosition.id,
      repertoireMoveId: target.repertoireMove.id,
    };

    await db.trainingAttempts.bulkAdd([
      directAttempt({
        ...base,
        review: {
          targetRepertoireMoveId: target.repertoireMove.id,
          rating: 'good',
          kind: 'scheduled',
          schedulingApplied: true,
          newCard: true,
        },
      }),
      directAttempt({
        ...base,
        review: {
          targetRepertoireMoveId: target.repertoireMove.id,
          rating: 'again',
          kind: 'relearning',
          schedulingApplied: false,
          newCard: false,
        },
      }),
      directAttempt({
        ...base,
        mode: 'opening:quick-recall',
        review: undefined,
      }),
    ]);

    const inventory = await repo.loadReviewInventory({ dueThroughIso: DUE_THROUGH });
    expect(inventory.newCandidates[0].priorScheduledReviews).toBe(1);
    await db.delete();
  });
});

describe('daily new review introductions', () => {
  it('counts only new-card review attempts inside the half-open time range', async () => {
    const { db, repo } = await setup();
    const metadata = {
      targetRepertoireMoveId: 'target',
      rating: 'good' as const,
      kind: 'scheduled' as const,
      schedulingApplied: true,
    };

    await db.trainingAttempts.bulkAdd([
      directAttempt({
        timestamp: '2026-10-01T04:00:00.000Z',
        review: { ...metadata, newCard: true },
      }),
      directAttempt({
        timestamp: '2026-10-01T05:00:00.000Z',
        review: { ...metadata, newCard: false },
      }),
      directAttempt({
        timestamp: '2026-10-02T04:00:00.000Z',
        review: { ...metadata, newCard: true },
      }),
    ]);

    expect(
      await repo.countNewReviewIntroductions(
        '2026-10-01T04:00:00.000Z',
        '2026-10-02T04:00:00.000Z',
      ),
    ).toBe(1);
    await db.delete();
  });
});
