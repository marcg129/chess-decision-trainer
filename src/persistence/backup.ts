import type { Table } from 'dexie';
import { createId, type LearnerProfile, type TrainingBackupV1 } from '../training/types';
import { parseAndValidateBackup } from './backupSchema';
import { ChessTrainingDatabase } from './db';
import {
  InvalidBackupError,
  ReferentialIntegrityError,
  ResetError,
  RestoreError,
  UnsupportedBackupVersionError,
} from './errors';
import { InvalidChessEdgeError } from '../training/errors';

export type RestoreHooks = {
  afterClear?: () => void | Promise<void>;
};

function userTables(db: ChessTrainingDatabase): Table[] {
  return [
    db.learnerProfiles,
    db.repertoires,
    db.positions,
    db.moveEdges,
    db.repertoirePositions,
    db.repertoireMoves,
    db.positionMastery,
    db.repertoireMoveMastery,
    db.trainingSessions,
    db.trainingAttempts,
  ];
}

async function bulkAddIfAny<T>(table: Table<T, string>, records: T[]): Promise<void> {
  if (records.length > 0) await table.bulkAdd(records);
}

export async function exportBackupData(
  db: ChessTrainingDatabase,
): Promise<TrainingBackupV1> {
  return db.transaction('r', userTables(db), async () => ({
    format: 'chess-decision-trainer',
    version: 1,
    exportedAt: new Date().toISOString(),
    schemaVersion: db.verno,
    data: {
      learnerProfiles: await db.learnerProfiles.toArray(),
      repertoires: await db.repertoires.toArray(),
      positions: await db.positions.toArray(),
      moveEdges: await db.moveEdges.toArray(),
      repertoirePositions: await db.repertoirePositions.toArray(),
      repertoireMoves: await db.repertoireMoves.toArray(),
      positionMastery: await db.positionMastery.toArray(),
      repertoireMoveMastery: await db.repertoireMoveMastery.toArray(),
      trainingSessions: await db.trainingSessions.toArray(),
      trainingAttempts: await db.trainingAttempts.toArray(),
    },
  }));
}

async function clearUserTables(db: ChessTrainingDatabase): Promise<void> {
  await Promise.all(userTables(db).map((table) => table.clear()));
}

async function addBackupRows(
  db: ChessTrainingDatabase,
  backup: TrainingBackupV1,
): Promise<void> {
  const data = backup.data;
  await bulkAddIfAny(db.learnerProfiles, data.learnerProfiles);
  await bulkAddIfAny(db.repertoires, data.repertoires);
  await bulkAddIfAny(db.positions, data.positions);
  await bulkAddIfAny(db.moveEdges, data.moveEdges);
  await bulkAddIfAny(db.repertoirePositions, data.repertoirePositions);
  await bulkAddIfAny(db.repertoireMoves, data.repertoireMoves);
  await bulkAddIfAny(db.positionMastery, data.positionMastery);
  await bulkAddIfAny(db.repertoireMoveMastery, data.repertoireMoveMastery);
  await bulkAddIfAny(db.trainingSessions, data.trainingSessions);
  await bulkAddIfAny(db.trainingAttempts, data.trainingAttempts);
}

async function verifyRestoredCounts(
  db: ChessTrainingDatabase,
  backup: TrainingBackupV1,
): Promise<void> {
  const data = backup.data;
  const actual = await Promise.all([
    db.learnerProfiles.count(),
    db.repertoires.count(),
    db.positions.count(),
    db.moveEdges.count(),
    db.repertoirePositions.count(),
    db.repertoireMoves.count(),
    db.positionMastery.count(),
    db.repertoireMoveMastery.count(),
    db.trainingSessions.count(),
    db.trainingAttempts.count(),
  ]);
  const expected = [
    data.learnerProfiles.length,
    data.repertoires.length,
    data.positions.length,
    data.moveEdges.length,
    data.repertoirePositions.length,
    data.repertoireMoves.length,
    data.positionMastery.length,
    data.repertoireMoveMastery.length,
    data.trainingSessions.length,
    data.trainingAttempts.length,
  ];
  if (actual.some((count, index) => count !== expected[index])) {
    throw new ReferentialIntegrityError('Restored row counts do not match the validated backup.');
  }
}

export async function restoreBackupData(
  db: ChessTrainingDatabase,
  backup: TrainingBackupV1,
  hooks: RestoreHooks = {},
): Promise<void> {
  const validated = parseAndValidateBackup(backup);
  const preRestore = await exportBackupData(db);
  await db.localBackups.add({
    id: createId(),
    createdAt: new Date().toISOString(),
    reason: 'pre-restore',
    backup: preRestore,
  });

  try {
    await db.transaction('rw', userTables(db), async () => {
      await clearUserTables(db);
      await hooks.afterClear?.();
      await addBackupRows(db, validated);
      await verifyRestoredCounts(db, validated);
    });
  } catch (error) {
    if (
      error instanceof InvalidBackupError ||
      error instanceof UnsupportedBackupVersionError ||
      error instanceof ReferentialIntegrityError ||
      error instanceof InvalidChessEdgeError
    ) {
      throw error;
    }
    throw new RestoreError(error instanceof Error ? error.message : 'Training data restore failed.');
  }
}

export async function getLatestPreRestoreBackupData(
  db: ChessTrainingDatabase,
): Promise<TrainingBackupV1 | null> {
  const record = await db.localBackups.orderBy('createdAt').reverse().first();
  return record?.backup ?? null;
}

export async function resetTrainingData(
  db: ChessTrainingDatabase,
): Promise<LearnerProfile> {
  const now = new Date().toISOString();
  const learner: LearnerProfile = {
    id: createId(),
    displayName: 'Local learner',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.transaction('rw', userTables(db), async () => {
      await clearUserTables(db);
      await db.learnerProfiles.add(learner);
    });
    return learner;
  } catch (error) {
    throw new ResetError(error instanceof Error ? error.message : 'Training data reset failed.');
  }
}
