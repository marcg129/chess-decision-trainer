import { TrainingDataService } from '../services/trainingDataService';
import { ChessTrainingDatabase } from './db';
import { DexieTrainingAdminRepository } from './dexieTrainingAdminRepository';
import { DexieTrainingRepository } from './dexieTrainingRepository';

let service: TrainingDataService | null = null;

export function getBrowserTrainingDataService(): TrainingDataService {
  if (service) return service;

  const db = new ChessTrainingDatabase('chess-decision-trainer');
  const training = new DexieTrainingRepository(db);
  const admin = new DexieTrainingAdminRepository(db);
  service = new TrainingDataService(training, admin);
  return service;
}
