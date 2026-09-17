import { render, screen } from '@testing-library/react';
import App from './App';
import type { OpeningTrainingService } from './services/openingTrainingService';
import type { TrainingDataService } from './services/trainingDataService';
import type { TrainingDataSummary } from './training/types';

const quietStorageService = {
  initialize: () => new Promise<TrainingDataSummary>(() => undefined),
  getPreRestoreBackup: () => Promise.resolve(null),
} as unknown as TrainingDataService;

const quietOpeningService = {
  listRepertoires: () => new Promise<never[]>(() => undefined),
} as unknown as OpeningTrainingService;

test('renders the chess core heading', () => {
  render(
    <App
      trainingDataService={quietStorageService}
      openingTrainingService={quietOpeningService}
    />,
  );
  expect(screen.getByRole('heading', { name: /chess decision trainer/i })).toBeInTheDocument();
});
