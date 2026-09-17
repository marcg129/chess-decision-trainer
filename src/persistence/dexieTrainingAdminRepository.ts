import type {
  LearnerProfile,
  RepertoireSummary,
  TrainingBackupV1,
  TrainingDataSummary,
} from '../training/types';
import {
  exportBackupData,
  getLatestPreRestoreBackupData,
  resetTrainingData,
  restoreBackupData,
} from './backup';
import type { ChessTrainingDatabase } from './db';
import { TransactionError } from './errors';

export class DexieTrainingAdminRepository {
  constructor(readonly db: ChessTrainingDatabase) {}

  async getSummary(): Promise<TrainingDataSummary> {
    return this.db.transaction(
      'r',
      [
        this.db.learnerProfiles,
        this.db.repertoires,
        this.db.positions,
        this.db.moveEdges,
        this.db.repertoirePositions,
        this.db.repertoireMoves,
        this.db.positionMastery,
        this.db.repertoireMoveMastery,
        this.db.trainingSessions,
        this.db.trainingAttempts,
      ],
      async () => {
        const learners = await this.db.learnerProfiles.toArray();
        if (learners.length !== 1) {
          throw new TransactionError(
            'Training data summary requires exactly one local learner profile.',
          );
        }

        const repertoires = await this.db.repertoires.toArray();
        const repertoireSummaries: RepertoireSummary[] = await Promise.all(
          repertoires.map(async (repertoire) => ({
            id: repertoire.id,
            name: repertoire.name,
            side: repertoire.side,
            archived: repertoire.archived,
            positions: await this.db.repertoirePositions
              .where('repertoireId')
              .equals(repertoire.id)
              .count(),
            moves: await this.db.repertoireMoves
              .where('repertoireId')
              .equals(repertoire.id)
              .count(),
            attempts: await this.db.trainingAttempts
              .where('repertoireId')
              .equals(repertoire.id)
              .count(),
          })),
        );

        const latestAttempt = await this.db.trainingAttempts.orderBy('timestamp').last();

        return {
          learner: learners[0],
          repertoires: repertoireSummaries,
          counts: {
            repertoires: repertoires.length,
            positions: await this.db.positions.count(),
            moveEdges: await this.db.moveEdges.count(),
            positionMastery: await this.db.positionMastery.count(),
            repertoireMoveMastery: await this.db.repertoireMoveMastery.count(),
            sessions: await this.db.trainingSessions.count(),
            attempts: await this.db.trainingAttempts.count(),
          },
          lastActivityAt: latestAttempt?.timestamp ?? null,
          schemaVersion: this.db.verno,
        };
      },
    );
  }

  exportBackup(): Promise<TrainingBackupV1> {
    return exportBackupData(this.db);
  }

  restoreBackup(backup: TrainingBackupV1): Promise<void> {
    return restoreBackupData(this.db, backup);
  }

  getLatestPreRestoreBackup(): Promise<TrainingBackupV1 | null> {
    return getLatestPreRestoreBackupData(this.db);
  }

  resetTrainingData(): Promise<LearnerProfile> {
    return resetTrainingData(this.db);
  }
}
