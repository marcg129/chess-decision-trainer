import 'fake-indexeddb/auto';
import type { TrainingBackup } from '../training/types';
import { ChessTrainingDatabase } from './db';
import {
  exportBackupData,
  getLatestPreRestoreBackupData,
  resetTrainingData,
  restoreBackupData,
} from './backup';
import { normalizeReviewSettings } from '../review/settings';
import { FsrsScheduler } from '../review/fsrsAdapter';
import { RestoreError } from './errors';
import { cloneBackup, makeValidBackup, seedBackup, testId } from './backupTestUtils';

function logicalBackup(backup: TrainingBackup) {
  return { ...backup, exportedAt: '<ignored>' };
}

test('export, reset, and restore reproduce the same logical dataset', async () => {
  const db = new ChessTrainingDatabase(`backup-roundtrip-${crypto.randomUUID()}`);
  await seedBackup(db, makeValidBackup('Round trip'));

  const before = await exportBackupData(db);
  await resetTrainingData(db);
  expect(await db.repertoires.count()).toBe(0);
  expect(await db.learnerProfiles.count()).toBe(1);

  await restoreBackupData(db, before);
  const after = await exportBackupData(db);
  expect(logicalBackup(after)).toEqual(logicalBackup(before));
  await db.delete();
});

test('invalid backup changes no user data', async () => {
  const db = new ChessTrainingDatabase(`backup-invalid-${crypto.randomUUID()}`);
  await seedBackup(db, makeValidBackup('Original'));
  const before = await exportBackupData(db);
  const invalid = cloneBackup(before);
  invalid.data.repertoires[0].learnerId = '00000000-0000-4000-8000-000000000099';

  await expect(restoreBackupData(db, invalid)).rejects.toThrow();
  expect(logicalBackup(await exportBackupData(db))).toEqual(logicalBackup(before));
  await db.delete();
});

test('forced failure after clear rolls back replacement completely', async () => {
  const db = new ChessTrainingDatabase(`backup-rollback-${crypto.randomUUID()}`);
  await seedBackup(db, makeValidBackup('Original'));
  const before = await exportBackupData(db);
  const replacement = makeValidBackup('Replacement');

  await expect(
    restoreBackupData(db, replacement, {
      afterClear: () => {
        throw new Error('forced restore failure');
      },
    }),
  ).rejects.toBeInstanceOf(RestoreError);

  expect(logicalBackup(await exportBackupData(db))).toEqual(logicalBackup(before));
  await db.delete();
});

test('successful restore preserves a downloadable pre-restore backup', async () => {
  const db = new ChessTrainingDatabase(`backup-recovery-${crypto.randomUUID()}`);
  await seedBackup(db, makeValidBackup('Before restore'));
  const before = await exportBackupData(db);

  await restoreBackupData(db, makeValidBackup('After restore'));
  const recovery = await getLatestPreRestoreBackupData(db);
  expect(recovery).not.toBeNull();
  expect(logicalBackup(recovery!)).toEqual(logicalBackup(before));
  await db.delete();
});

test('reset clears user data, keeps schema, and recreates one clean local learner', async () => {
  const db = new ChessTrainingDatabase(`backup-reset-${crypto.randomUUID()}`);
  await seedBackup(db, makeValidBackup('Reset me'));

  const learner = await resetTrainingData(db);
  expect(learner.displayName).toBe('Local learner');
  expect(await db.learnerProfiles.count()).toBe(1);
  expect(await db.repertoires.count()).toBe(0);
  expect(await db.positions.count()).toBe(0);
  expect(await db.trainingAttempts.count()).toBe(0);
  expect(db.verno).toBe(3);
  expect(db.tables.some((table) => table.name === 'localBackups')).toBe(true);
  await db.delete();
});


test('new exports use backup V2 and preserve Phase 4 review data through restore', async () => {
  const db = new ChessTrainingDatabase(`backup-v2-${crypto.randomUUID()}`);
  const base = makeValidBackup('Phase 4 round trip');
  await seedBackup(db, base);

  const learner = (await db.learnerProfiles.toArray())[0];
  await db.learnerProfiles.put({
    ...learner,
    reviewSettings: { newItemsPerDay: 7, batchSize: 25 },
  });

  const targetMoveId = base.data.repertoireMoves[0].id;
  const reviewedAt = new Date('2026-10-01T12:00:00.000Z');
  const scheduled = new FsrsScheduler().schedule(null, 'good', reviewedAt);
  await db.repertoireMoveMastery.add({
    id: testId(30),
    repertoireMoveId: targetMoveId,
    attempts: 1,
    correct: 1,
    incorrect: 0,
    streak: 1,
    averageDecisionTimeMs: 1400,
    lastAttemptedAt: reviewedAt.toISOString(),
    state: 'new',
    score: 0,
    nextReviewAt: scheduled.nextReviewAt,
    schedulingData: scheduled.schedulingData,
    updatedAt: reviewedAt.toISOString(),
  });
  await db.trainingAttempts.add({
    id: testId(31),
    timestamp: reviewedAt.toISOString(),
    repertoireId: base.data.repertoires[0].id,
    positionId: base.data.positions[0].id,
    repertoireMoveId: targetMoveId,
    expectedMove: base.data.moveEdges[0].moveKey,
    actualMove: base.data.moveEdges[0].moveKey,
    correct: true,
    decisionTimeMs: 1400,
    hintCount: 0,
    hintUsed: false,
    mode: 'opening:review-due',
    review: {
      targetRepertoireMoveId: targetMoveId,
      rating: 'good',
      kind: 'scheduled',
      schedulingApplied: true,
      newCard: true,
    },
    masteryBefore: {
      positionState: 'new',
      positionScore: 0,
      repertoireMoveState: 'new',
      repertoireMoveScore: 0,
    },
    masteryAfter: {
      positionState: 'new',
      positionScore: 0,
      repertoireMoveState: 'new',
      repertoireMoveScore: 0,
    },
  });

  const exported = await exportBackupData(db);
  expect(exported.version).toBe(2);

  await resetTrainingData(db);
  await restoreBackupData(db, exported);
  const restored = await exportBackupData(db);

  expect(logicalBackup(restored)).toEqual(logicalBackup(exported));
  expect(
    normalizeReviewSettings((await db.learnerProfiles.toArray())[0].reviewSettings),
  ).toEqual({ newItemsPerDay: 7, batchSize: 25 });
  await db.delete();
});

test('unchanged V1 backups still restore with default review settings and no synthetic schedules', async () => {
  const db = new ChessTrainingDatabase(`backup-v1-compat-${crypto.randomUUID()}`);
  await seedBackup(db, makeValidBackup('Existing data'));
  const v1 = makeValidBackup('Legacy V1');

  await restoreBackupData(db, v1);

  const learner = (await db.learnerProfiles.toArray())[0];
  expect(normalizeReviewSettings(learner.reviewSettings)).toEqual({
    newItemsPerDay: 10,
    batchSize: 15,
  });
  expect(await db.repertoireMoveMastery.count()).toBe(0);
  expect(await db.trainingAttempts.count()).toBe(0);
  await db.delete();
});
