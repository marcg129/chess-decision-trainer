import { parseAndValidateBackup } from '../persistence/backupSchema';
import type {
  TrainingAdminRepository,
  TrainingRepository,
} from '../training/repositories';
import type { TrainingBackupV1, TrainingDataSummary } from '../training/types';

export class TrainingDataService {
  constructor(
    private readonly training: TrainingRepository,
    private readonly admin: TrainingAdminRepository,
  ) {}

  async initialize(): Promise<TrainingDataSummary> {
    await this.training.ensureLocalLearner('Local learner');
    return this.admin.getSummary();
  }

  refreshSummary(): Promise<TrainingDataSummary> {
    return this.admin.getSummary();
  }

  exportBackup(): Promise<TrainingBackupV1> {
    return this.admin.exportBackup();
  }

  validateBackup(input: unknown): TrainingBackupV1 {
    return parseAndValidateBackup(input);
  }

  async restoreBackup(backup: TrainingBackupV1): Promise<TrainingDataSummary> {
    await this.admin.restoreBackup(backup);
    return this.admin.getSummary();
  }

  getPreRestoreBackup(): Promise<TrainingBackupV1 | null> {
    return this.admin.getLatestPreRestoreBackup();
  }

  async reset(): Promise<TrainingDataSummary> {
    await this.admin.resetTrainingData();
    return this.admin.getSummary();
  }
}
