import 'fake-indexeddb/auto';
import { Chess } from 'chess.js';
import { ChessTrainingDatabase } from '../persistence/db';
import { DexieTrainingAdminRepository } from '../persistence/dexieTrainingAdminRepository';
import { DexieTrainingRepository } from '../persistence/dexieTrainingRepository';
import { createId, type Repertoire } from '../training/types';
import { TrainingDataService } from './trainingDataService';

function makeRepertoire(learnerId: string, name: string): Repertoire {
  const now = new Date().toISOString();
  return {
    id: createId(),
    learnerId,
    name,
    side: 'mixed',
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function setup() {
  const db = new ChessTrainingDatabase(`service-${crypto.randomUUID()}`);
  const training = new DexieTrainingRepository(db);
  const admin = new DexieTrainingAdminRepository(db);
  const service = new TrainingDataService(training, admin);
  return { db, training, admin, service };
}

test('initialize creates exactly one local learner on a fresh database', async () => {
  const { db, service } = await setup();
  const summary = await service.initialize();

  expect(summary.learner.displayName).toBe('Local learner');
  expect(summary.counts.repertoires).toBe(0);
  expect(summary.counts.attempts).toBe(0);
  expect(await db.learnerProfiles.count()).toBe(1);
  await db.delete();
});

test('summary reports multiple repertoires sharing canonical graph records', async () => {
  const { db, training, service } = await setup();
  const learner = await training.ensureLocalLearner();
  const a = makeRepertoire(learner.id, 'White A');
  const b = makeRepertoire(learner.id, 'White B');
  await training.saveRepertoire(a);
  await training.saveRepertoire(b);

  const first = await training.upsertRepertoireTransition({
    repertoireId: a.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2', to: 'e4' },
    role: 'learner',
    preferred: true,
    trainable: true,
  });
  await training.upsertRepertoireTransition({
    repertoireId: b.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2', to: 'e4' },
    role: 'learner',
    preferred: true,
    trainable: true,
  });

  await training.recordAttempt({
    timestamp: '2026-09-17T01:02:03.000Z',
    repertoireId: a.id,
    positionId: first.fromPosition.id,
    repertoireMoveId: first.repertoireMove.id,
    expectedMove: first.moveEdge.moveKey,
    actualMove: first.moveEdge.moveKey,
    correct: true,
    decisionTimeMs: 900,
    hintCount: 0,
    hintUsed: false,
    mode: 'opening',
  });

  const summary = await service.refreshSummary();
  expect(summary.repertoires.map((item) => item.name).sort()).toEqual([
    'White A',
    'White B',
  ]);
  expect(summary.counts.repertoires).toBe(2);
  expect(summary.counts.positions).toBe(2);
  expect(summary.counts.moveEdges).toBe(1);
  expect(summary.counts.positionMastery).toBe(1);
  expect(summary.counts.repertoireMoveMastery).toBe(1);
  expect(summary.counts.attempts).toBe(1);
  expect(summary.lastActivityAt).toBe('2026-09-17T01:02:03.000Z');
  expect(summary.schemaVersion).toBe(2);

  const aSummary = summary.repertoires.find((item) => item.id === a.id);
  const bSummary = summary.repertoires.find((item) => item.id === b.id);
  expect(aSummary).toMatchObject({ positions: 2, moves: 1, attempts: 1 });
  expect(bSummary).toMatchObject({ positions: 2, moves: 1, attempts: 0 });
  await db.delete();
});
