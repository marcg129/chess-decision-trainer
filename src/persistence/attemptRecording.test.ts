import 'fake-indexeddb/auto';
import { Chess } from 'chess.js';
import { ChessTrainingDatabase } from './db';
import { DexieTrainingRepository } from './dexieTrainingRepository';
import { TransactionError } from './errors';
import { createId, type Repertoire } from '../training/types';

async function setupAttemptContext() {
  const db = new ChessTrainingDatabase(`attempt-${crypto.randomUUID()}`);
  const repo = new DexieTrainingRepository(db);
  const learner = await repo.ensureLocalLearner();
  const now = new Date().toISOString();
  const repertoire: Repertoire = {
    id: createId(),
    learnerId: learner.id,
    name: 'Attempts',
    side: 'white',
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await repo.saveRepertoire(repertoire);
  const transition = await repo.upsertRepertoireTransition({
    repertoireId: repertoire.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2', to: 'e4' },
    role: 'learner',
    preferred: true,
    trainable: true,
  });
  return { db, repo, repertoire, transition };
}

test('recordAttempt atomically appends history and updates both mastery layers', async () => {
  const { db, repo, repertoire, transition } = await setupAttemptContext();
  const sessionId = createId();
  await repo.createSession({
    id: sessionId,
    repertoireId: repertoire.id,
    mode: 'opening',
    startedAt: '2026-09-17T00:00:00.000Z',
  });

  const attempt = await repo.recordAttempt({
    timestamp: '2026-09-17T00:00:05.000Z',
    sessionId,
    repertoireId: repertoire.id,
    positionId: transition.fromPosition.id,
    repertoireMoveId: transition.repertoireMove.id,
    expectedMove: transition.moveEdge.moveKey,
    actualMove: transition.moveEdge.moveKey,
    correct: true,
    decisionTimeMs: 1200,
    hintCount: 0,
    hintUsed: false,
    mode: 'opening',
  });

  expect(await db.trainingAttempts.count()).toBe(1);
  expect(attempt.sessionId).toBe(sessionId);
  expect(attempt.masteryBefore.positionState).toBe('new');
  expect(attempt.masteryAfter.positionScore).toBe(0);
  expect(attempt.masteryAfter.repertoireMoveState).toBe('new');
  expect((await repo.getPositionMastery(transition.fromPosition.id))?.attempts).toBe(1);
  expect((await repo.getPositionMastery(transition.fromPosition.id))?.correct).toBe(1);
  expect((await repo.getRepertoireMoveMastery(transition.repertoireMove.id))?.attempts).toBe(1);
  expect((await repo.getRepertoireMoveMastery(transition.repertoireMove.id))?.streak).toBe(1);
  await db.delete();
});

test('failed repertoire-move resolution rolls back inserted attempt and mastery updates', async () => {
  const { db, repo, repertoire, transition } = await setupAttemptContext();
  const beforeAttemptCount = await db.trainingAttempts.count();
  const beforePositionMasteryCount = await db.positionMastery.count();
  const beforeMoveMasteryCount = await db.repertoireMoveMastery.count();

  await expect(
    repo.recordAttempt({
      timestamp: '2026-09-17T00:00:05.000Z',
      repertoireId: repertoire.id,
      positionId: transition.fromPosition.id,
      repertoireMoveId: createId(),
      expectedMove: transition.moveEdge.moveKey,
      actualMove: transition.moveEdge.moveKey,
      correct: true,
      decisionTimeMs: 1200,
      hintCount: 0,
      hintUsed: false,
      mode: 'opening',
    }),
  ).rejects.toBeInstanceOf(TransactionError);

  expect(await db.trainingAttempts.count()).toBe(beforeAttemptCount);
  expect(await db.positionMastery.count()).toBe(beforePositionMasteryCount);
  expect(await db.repertoireMoveMastery.count()).toBe(beforeMoveMasteryCount);
  await db.delete();
});

test('returns the existing attempt without updating mastery twice when attemptId is retried', async () => {
  const { db, repo, repertoire, transition } = await setupAttemptContext();
  const input = {
    attemptId: '11111111-1111-4111-8111-111111111111',
    timestamp: '2026-09-17T00:00:05.000Z',
    repertoireId: repertoire.id,
    positionId: transition.fromPosition.id,
    repertoireMoveId: transition.repertoireMove.id,
    expectedMove: transition.moveEdge.moveKey,
    actualMove: transition.moveEdge.moveKey,
    correct: true,
    decisionTimeMs: 1200,
    hintCount: 0,
    hintUsed: false,
    mode: 'opening',
  };
  const first = await repo.recordAttempt(input);
  const second = await repo.recordAttempt(input);
  expect(second.id).toBe(first.id);
  expect(await db.trainingAttempts.count()).toBe(1);
  expect((await db.positionMastery.toArray())[0].attempts).toBe(1);
  await db.delete();
});
