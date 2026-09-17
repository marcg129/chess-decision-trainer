import { OpeningTrainingService } from '../services/openingTrainingService';
import { TrainingDataService } from '../services/trainingDataService';
import { ChessTrainingDatabase } from './db';
import { DexieTrainingAdminRepository } from './dexieTrainingAdminRepository';
import { DexieTrainingRepository } from './dexieTrainingRepository';

type BrowserTrainingRuntime = {
  data: TrainingDataService;
  openings: OpeningTrainingService;
};

let runtime: BrowserTrainingRuntime | null = null;

function getRuntime(): BrowserTrainingRuntime {
  if (runtime) return runtime;

  const db = new ChessTrainingDatabase('chess-decision-trainer');
  const training = new DexieTrainingRepository(db);
  const admin = new DexieTrainingAdminRepository(db);
  runtime = {
    data: new TrainingDataService(training, admin),
    openings: new OpeningTrainingService(training),
  };
  return runtime;
}

export function getBrowserTrainingDataService(): TrainingDataService {
  return getRuntime().data;
}

export function getBrowserOpeningTrainingService(): OpeningTrainingService {
  return getRuntime().openings;
}
