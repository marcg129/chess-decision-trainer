import { Chess } from 'chess.js';
import { deriveTransition } from '../training/graph';
import type { TrainingBackupV1 } from '../training/types';
import type { ChessTrainingDatabase } from './db';

export function testId(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

export function makeValidBackup(name = 'Test repertoire'): TrainingBackupV1 {
  const start = new Chess().fen();
  const transition = deriveTransition(start, { from: 'e2', to: 'e4' });
  const now = '2026-09-17T00:00:00.000Z';
  const learnerId = testId(1);
  const repertoireId = testId(2);
  const fromPositionId = testId(3);
  const toPositionId = testId(4);
  const moveEdgeId = testId(5);
  const fromMembershipId = testId(6);
  const toMembershipId = testId(7);
  const repertoireMoveId = testId(8);

  return {
    format: 'chess-decision-trainer',
    version: 1,
    exportedAt: now,
    schemaVersion: 2,
    data: {
      learnerProfiles: [
        { id: learnerId, displayName: 'Test learner', createdAt: now, updatedAt: now },
      ],
      repertoires: [
        {
          id: repertoireId,
          learnerId,
          name,
          side: 'white',
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      positions: [
        {
          id: fromPositionId,
          positionKey: transition.fromPositionKey,
          fen: transition.fromFen,
          sideToMove: 'w',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: toPositionId,
          positionKey: transition.toPositionKey,
          fen: transition.toFen,
          sideToMove: 'b',
          createdAt: now,
          updatedAt: now,
        },
      ],
      moveEdges: [
        {
          id: moveEdgeId,
          fromPositionId,
          toPositionId,
          moveKey: transition.moveKey,
          from: transition.from,
          to: transition.to,
          promotion: transition.promotion,
          san: transition.san,
          createdAt: now,
        },
      ],
      repertoirePositions: [
        {
          id: fromMembershipId,
          repertoireId,
          positionId: fromPositionId,
          trainable: true,
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: toMembershipId,
          repertoireId,
          positionId: toPositionId,
          trainable: false,
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      repertoireMoves: [
        {
          id: repertoireMoveId,
          repertoireId,
          moveEdgeId,
          role: 'learner',
          preferred: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      positionMastery: [],
      repertoireMoveMastery: [],
      trainingSessions: [],
      trainingAttempts: [],
    },
  };
}

export function cloneBackup(backup: TrainingBackupV1): TrainingBackupV1 {
  return structuredClone(backup);
}

export async function seedBackup(
  db: ChessTrainingDatabase,
  backup: TrainingBackupV1,
): Promise<void> {
  await db.transaction(
    'rw',
    [
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
    ],
    async () => {
      await db.learnerProfiles.bulkAdd(backup.data.learnerProfiles);
      await db.repertoires.bulkAdd(backup.data.repertoires);
      await db.positions.bulkAdd(backup.data.positions);
      await db.moveEdges.bulkAdd(backup.data.moveEdges);
      await db.repertoirePositions.bulkAdd(backup.data.repertoirePositions);
      await db.repertoireMoves.bulkAdd(backup.data.repertoireMoves);
      await db.positionMastery.bulkAdd(backup.data.positionMastery);
      await db.repertoireMoveMastery.bulkAdd(backup.data.repertoireMoveMastery);
      await db.trainingSessions.bulkAdd(backup.data.trainingSessions);
      await db.trainingAttempts.bulkAdd(backup.data.trainingAttempts);
    },
  );
}
