import type { LearnerProfile, TrainingBackupV1 } from '../training/types';
import {
  exportBackupData,
  getLatestPreRestoreBackupData,
  resetTrainingData,
  restoreBackupData,
} from './backup';
import type { ChessTrainingDatabase } from './db';

export class DexieTrainingAdminRepository {
  constructor(readonly db: ChessTrainingDatabase) {}

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
