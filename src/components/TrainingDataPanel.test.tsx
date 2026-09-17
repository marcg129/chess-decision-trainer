import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TrainingDataService } from '../services/trainingDataService';
import type { TrainingDataSummary } from '../training/types';
import { makeValidBackup } from '../persistence/backupTestUtils';
import { TrainingDataPanel } from './TrainingDataPanel';

const summary: TrainingDataSummary = {
  learner: {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Local learner',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
  },
  repertoires: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'White repertoire',
      side: 'white',
      archived: false,
      positions: 12,
      moves: 9,
      attempts: 4,
    },
  ],
  counts: {
    repertoires: 1,
    positions: 12,
    moveEdges: 9,
    positionMastery: 5,
    repertoireMoveMastery: 4,
    sessions: 2,
    attempts: 4,
  },
  lastActivityAt: '2026-09-17T01:02:03.000Z',
  schemaVersion: 2,
};

function fakeService(overrides: Partial<TrainingDataService> = {}): TrainingDataService {
  return {
    initialize: vi.fn().mockResolvedValue(summary),
    refreshSummary: vi.fn().mockResolvedValue(summary),
    exportBackup: vi.fn().mockResolvedValue(makeValidBackup()),
    validateBackup: vi.fn((input) => input as ReturnType<typeof makeValidBackup>),
    restoreBackup: vi.fn().mockResolvedValue(summary),
    getPreRestoreBackup: vi.fn().mockResolvedValue(null),
    reset: vi.fn().mockResolvedValue(summary),
    ...overrides,
  } as unknown as TrainingDataService;
}

test('renders learner, repertoire, counts, activity, and schema version', async () => {
  render(<TrainingDataPanel service={fakeService()} />);

  expect(await screen.findByRole('heading', { name: /training data/i })).toBeInTheDocument();
  expect(screen.getByText('Local learner')).toBeInTheDocument();
  expect(screen.getByText('White repertoire')).toBeInTheDocument();
  expect(screen.getByText(/12 positions/i)).toBeInTheDocument();
  expect(screen.getByText(/schema 2/i)).toBeInTheDocument();
});

test('exports a versioned JSON backup with a stable filename prefix', async () => {
  const service = fakeService();
  const createObjectURL = vi.fn(() => 'blob:test');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  let filename = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    filename = this.download;
  });

  render(<TrainingDataPanel service={service} />);
  await screen.findByText('White repertoire');
  await userEvent.click(screen.getByRole('button', { name: /export backup/i }));

  expect(service.exportBackup).toHaveBeenCalledOnce();
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(filename).toMatch(/^chess-decision-trainer-backup-/);
  expect(revokeObjectURL).toHaveBeenCalledOnce();
});

test('invalid selected backup shows an alert and no replace action', async () => {
  const service = fakeService({
    validateBackup: vi.fn(() => {
      throw new Error('Invalid backup');
    }),
  });
  render(<TrainingDataPanel service={service} />);
  await screen.findByText('White repertoire');

  const file = new File(['{}'], 'bad.json', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText(/restore backup file/i), {
    target: { files: [file] },
  });

  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid backup/i);
  expect(screen.queryByRole('button', { name: /replace local data/i })).not.toBeInTheDocument();
});

test('valid restore shows counts and requires explicit replacement confirmation', async () => {
  const backup = makeValidBackup('Imported repertoire');
  const restored = {
    ...summary,
    repertoires: [{ ...summary.repertoires[0], name: 'Imported repertoire' }],
  };
  const service = fakeService({
    validateBackup: vi.fn(() => backup),
    restoreBackup: vi.fn().mockResolvedValue(restored),
  });
  render(<TrainingDataPanel service={service} />);
  await screen.findByText('White repertoire');

  const file = new File([JSON.stringify(backup)], 'backup.json', {
    type: 'application/json',
  });
  fireEvent.change(screen.getByLabelText(/restore backup file/i), {
    target: { files: [file] },
  });

  expect(await screen.findByText(/1 repertoire/i)).toBeInTheDocument();
  expect(screen.getByText(/2 positions/i)).toBeInTheDocument();
  expect(service.restoreBackup).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: /replace local data/i }));
  expect(service.restoreBackup).toHaveBeenCalledWith(backup);
  expect(await screen.findByText('Imported repertoire')).toBeInTheDocument();
});

test('reset requires a second explicit confirmation', async () => {
  const service = fakeService();
  render(<TrainingDataPanel service={service} />);
  await screen.findByText('White repertoire');

  await userEvent.click(screen.getByRole('button', { name: /^reset local data$/i }));
  expect(service.reset).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /confirm reset/i }));
  expect(service.reset).toHaveBeenCalledOnce();
});

test('initialization failures surface as an alert instead of throwing', async () => {
  const service = fakeService({
    initialize: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
  });
  render(<TrainingDataPanel service={service} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/storage unavailable/i);
  await waitFor(() => expect(service.initialize).toHaveBeenCalledOnce());
});
