import 'fake-indexeddb/auto';
import { ChessTrainingDatabase } from './db';
import {
  exportBackupData,
  getLatestPreRestoreBackupData,
  resetTrainingData,
  restoreBackupData,
} from './backup';
import { RestoreError } from './errors';
import { cloneBackup, makeValidBackup, seedBackup } from './backupTestUtils';

function logicalBackup(backup: Awaited<ReturnType<typeof exportBackupData>>) {
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
  expect(db.verno).toBe(2);
  expect(db.tables.some((table) => table.name === 'localBackups')).toBe(true);
  await db.delete();
});
