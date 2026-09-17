import { render, screen } from '@testing-library/react';
import App from './App';
import type { TrainingDataService } from './services/trainingDataService';
import type { TrainingDataSummary } from './training/types';

const quietStorageService = {
  initialize: () => new Promise<TrainingDataSummary>(() => undefined),
  getPreRestoreBackup: () => Promise.resolve(null),
} as unknown as TrainingDataService;

test('renders the chess core heading', () => {
  render(<App trainingDataService={quietStorageService} />);
  expect(screen.getByRole('heading', { name: /chess decision trainer/i })).toBeInTheDocument();
});
