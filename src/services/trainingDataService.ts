import { parseAndValidateBackup } from '../persistence/backupSchema';
import type {
  TrainingAdminRepository,
  TrainingRepository,
} from '../training/repositories';
import type {
  TrainingBackup,
  TrainingBackupV2,
  TrainingDataSummary,
} from '../training/types';

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

  exportBackup(): Promise<TrainingBackupV2> {
    return this.admin.exportBackup();
  }

  validateBackup(input: unknown): TrainingBackup {
    return parseAndValidateBackup(input);
  }

  async restoreBackup(backup: TrainingBackup): Promise<TrainingDataSummary> {
    await this.admin.restoreBackup(backup);
    return this.admin.getSummary();
  }

  getPreRestoreBackup(): Promise<TrainingBackup | null> {
    return this.admin.getLatestPreRestoreBackup();
  }

  async reset(): Promise<TrainingDataSummary> {
    await this.admin.resetTrainingData();
    return this.admin.getSummary();
  }
}
