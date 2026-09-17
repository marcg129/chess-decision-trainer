import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Chess } from 'chess.js';
import { ChessTrainingDatabase, V1_STORES } from './db';
import { DexieTrainingRepository } from './dexieTrainingRepository';
import { createId, type Repertoire } from '../training/types';

function fenAfter(moves: string[]): string {
  const chess = new Chess();
  for (const move of moves) chess.move(move);
  return chess.fen();
}

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
  const name = `test-${crypto.randomUUID()}`;
  const db = new ChessTrainingDatabase(name);
  const repo = new DexieTrainingRepository(db);
  const learner = await repo.ensureLocalLearner();
  return { name, db, repo, learner };
}

test('local learner creation is idempotent and survives reopen', async () => {
  const { name, db, repo } = await setup();
  const first = await repo.ensureLocalLearner();
  const second = await repo.ensureLocalLearner('Ignored replacement');
  expect(second.id).toBe(first.id);
  await db.close();

  const reopened = new ChessTrainingDatabase(name);
  const reopenedRepo = new DexieTrainingRepository(reopened);
  expect((await reopenedRepo.ensureLocalLearner()).id).toBe(first.id);
  await reopened.delete();
});

test('canonical positions and move edges are shared across repertoires', async () => {
  const { db, repo, learner } = await setup();
  const a = makeRepertoire(learner.id, 'A');
  const b = makeRepertoire(learner.id, 'B');
  await repo.saveRepertoire(a);
  await repo.saveRepertoire(b);

  const first = await repo.upsertRepertoireTransition({
    repertoireId: a.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2', to: 'e4' },
    role: 'learner',
    preferred: true,
    trainable: true,
  });
  const second = await repo.upsertRepertoireTransition({
    repertoireId: b.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2', to: 'e4' },
    role: 'learner',
    preferred: true,
    trainable: true,
  });

  expect(second.fromPosition.id).toBe(first.fromPosition.id);
  expect(second.toPosition.id).toBe(first.toPosition.id);
  expect(second.moveEdge.id).toBe(first.moveEdge.id);
  expect(second.repertoireMove.id).not.toBe(first.repertoireMove.id);
  await db.delete();
});

test('repeated repertoire transition reuses relationship records', async () => {
  const { db, repo, learner } = await setup();
  const repertoire = makeRepertoire(learner.id, 'Repeat');
  await repo.saveRepertoire(repertoire);
  const input = {
    repertoireId: repertoire.id,
    fromFen: new Chess().fen(),
    move: { from: 'e2' as const, to: 'e4' as const },
    role: 'learner' as const,
    preferred: true,
    trainable: true,
  };

  const first = await repo.upsertRepertoireTransition(input);
  const second = await repo.upsertRepertoireTransition(input);
  expect(second.repertoirePosition.id).toBe(first.repertoirePosition.id);
  expect(second.repertoireMove.id).toBe(first.repertoireMove.id);
  expect(await db.repertoirePositions.where('repertoireId').equals(repertoire.id).count()).toBe(2);
  await db.delete();
});

test('transposed move orders converge on the same canonical destination', async () => {
  const { db, repo, learner } = await setup();
  const repertoire = makeRepertoire(learner.id, 'Transpositions');
  await repo.saveRepertoire(repertoire);

  const pathA = await repo.upsertRepertoireTransition({
    repertoireId: repertoire.id,
    fromFen: fenAfter(['Nf3', 'Nf6', 'g3']),
    move: { from: 'g7', to: 'g6' },
    role: 'opponent',
    preferred: false,
    trainable: true,
  });
  const pathB = await repo.upsertRepertoireTransition({
    repertoireId: repertoire.id,
    fromFen: fenAfter(['g3', 'g6', 'Nf3']),
    move: { from: 'g8', to: 'f6' },
    role: 'opponent',
    preferred: false,
    trainable: true,
  });

  expect(pathB.toPosition.positionKey).toBe(pathA.toPosition.positionKey);
  expect(pathB.toPosition.id).toBe(pathA.toPosition.id);
  await db.delete();
});

test('creates a repertoire and all transitions atomically', async () => {
  const { db, repo, learner } = await setup();
  const repertoire = makeRepertoire(learner.id, 'Bulk');
  await repo.createRepertoireFromTransitions({
    repertoire,
    transitions: [
      {
        repertoireId: repertoire.id,
        fromFen: new Chess().fen(),
        move: { from: 'e2', to: 'e4' },
        role: 'learner', preferred: true, trainable: true, order: 0,
      },
      {
        repertoireId: repertoire.id,
        fromFen: fenAfter(['e4']),
        move: { from: 'e7', to: 'e5' },
        role: 'opponent', preferred: false, trainable: false, order: 1,
      },
    ],
  });
  expect(await db.repertoires.get(repertoire.id)).toEqual(repertoire);
  expect(await db.repertoireMoves.count()).toBe(2);
  await db.delete();
});

test('does not leave a partial repertoire when one bulk transition is invalid', async () => {
  const { db, repo, learner } = await setup();
  const repertoire = makeRepertoire(learner.id, 'Broken bulk');
  await expect(repo.createRepertoireFromTransitions({
    repertoire,
    transitions: [
      {
        repertoireId: repertoire.id, fromFen: new Chess().fen(),
        move: { from: 'e2', to: 'e4' }, role: 'learner', preferred: true, trainable: true,
      },
      {
        repertoireId: repertoire.id, fromFen: new Chess().fen(),
        move: { from: 'e2', to: 'e5' }, role: 'learner', preferred: false, trainable: true,
      },
    ],
  })).rejects.toThrow();
  expect(await db.repertoires.get(repertoire.id)).toBeUndefined();
  expect(await db.repertoireMoves.count()).toBe(0);
  await db.delete();
});

test('bulk imports reuse canonical graph rows across separate repertoires', async () => {
  const { db, repo, learner } = await setup();
  const first = makeRepertoire(learner.id, 'First bulk');
  const second = makeRepertoire(learner.id, 'Second bulk');
  const transitionFor = (repertoireId: string) => ({
    repertoireId,
    fromFen: new Chess().fen(),
    move: { from: 'e2' as const, to: 'e4' as const },
    role: 'learner' as const,
    preferred: true,
    trainable: true,
  });
  await repo.createRepertoireFromTransitions({ repertoire: first, transitions: [transitionFor(first.id)] });
  const positionsAfterFirst = await db.positions.count();
  const edgesAfterFirst = await db.moveEdges.count();
  await repo.createRepertoireFromTransitions({ repertoire: second, transitions: [transitionFor(second.id)] });
  expect(await db.positions.count()).toBe(positionsAfterFirst);
  expect(await db.moveEdges.count()).toBe(edgesAfterFirst);
  expect(await db.repertoires.count()).toBe(2);
  await db.delete();
});

test('loads a repertoire-scoped training snapshot and completes sessions in place', async () => {
  const { db, repo, learner } = await setup();
  const repertoire = makeRepertoire(learner.id, 'Snapshot');
  await repo.createRepertoireFromTransitions({
    repertoire,
    transitions: [{
      repertoireId: repertoire.id, fromFen: new Chess().fen(),
      move: { from: 'e2', to: 'e4' }, role: 'learner', preferred: true, trainable: true,
    }],
  });
  const sessionId = createId();
  await repo.createSession({ id: sessionId, repertoireId: repertoire.id, mode: 'practice-line', startedAt: '2026-09-17T10:00:00.000Z' });
  const snapshot = await repo.loadRepertoireTrainingSnapshot(repertoire.id);
  expect(snapshot.repertoire.id).toBe(repertoire.id);
  expect(snapshot.repertoireMoves).toHaveLength(1);
  expect(snapshot.positions.length).toBeGreaterThan(0);
  expect(snapshot.attempts).toEqual([]);

  await repo.completeSession(sessionId, '2026-09-17T10:05:00.000Z');
  expect(await db.trainingSessions.get(sessionId)).toMatchObject({
    id: sessionId,
    startedAt: '2026-09-17T10:00:00.000Z',
    completedAt: '2026-09-17T10:05:00.000Z',
  });
  await db.delete();
});

test('version 2 migration preserves version 1 learner and repertoire rows', async () => {
  const name = `migration-${crypto.randomUUID()}`;
  const raw = new Dexie(name);
  raw.version(1).stores(V1_STORES);
  const learnerId = createId();
  const repertoireId = createId();
  const now = new Date().toISOString();
  await raw.open();
  await raw.table('learnerProfiles').add({
    id: learnerId,
    displayName: 'Legacy learner',
    createdAt: now,
    updatedAt: now,
  });
  await raw.table('repertoires').add({
    id: repertoireId,
    learnerId,
    name: 'Legacy repertoire',
    side: 'white',
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  raw.close();

  const upgraded = new ChessTrainingDatabase(name);
  await upgraded.open();
  expect((await upgraded.learnerProfiles.get(learnerId))?.displayName).toBe('Legacy learner');
  expect((await upgraded.repertoires.get(repertoireId))?.name).toBe('Legacy repertoire');
  expect(upgraded.verno).toBe(2);
  expect(upgraded.tables.some((table) => table.name === 'localBackups')).toBe(true);
  await upgraded.delete();
});
