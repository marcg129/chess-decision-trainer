import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChessTrainingDatabase } from '../../persistence/db';
import { DexieTrainingRepository } from '../../persistence/dexieTrainingRepository';
import { OpeningTrainingService } from '../../services/openingTrainingService';
import { OpeningTrainingEngine } from './engine';

const databases: ChessTrainingDatabase[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (databases.length) {
    const db = databases.pop();
    if (db) await db.delete();
  }
});

describe('OpeningTrainingEngine concurrent submissions', () => {
  it('accepts only one submission while the current prompt attempt is being persisted', async () => {
    const db = new ChessTrainingDatabase(`engine-concurrent-${crypto.randomUUID()}`);
    databases.push(db);
    const repository = new DexieTrainingRepository(db);
    const service = new OpeningTrainingService(repository);
    const document = service.parsePgn('[Event "Concurrent"]\n[Result "*"]\n1. e4 e5 2. Nf3 *');
    const plan = service.previewImport({
      document,
      name: 'Concurrent fixture',
      side: 'white',
      selectedGameIndexes: [0],
    });
    const repertoire = await service.commitImport(plan);
    const snapshot = await service.loadRepertoire(repertoire.id);
    const engine = await OpeningTrainingEngine.start({
      snapshot,
      repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });

    const originalRecordAttempt = repository.recordAttempt.bind(repository);
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const record = vi.spyOn(repository, 'recordAttempt').mockImplementation(async (input) => {
      await persistenceGate;
      return originalRecordAttempt(input);
    });

    const first = engine.submitMove({ from: 'e2', to: 'e4' });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));

    const second = engine.submitMove({ from: 'e2', to: 'e4' });
    await Promise.resolve();
    expect(record).toHaveBeenCalledTimes(1);

    releasePersistence();
    await first;
    await second;

    expect(record).toHaveBeenCalledTimes(1);
    expect(await db.trainingAttempts.count()).toBe(1);
    expect(engine.state().progress.completed).toBe(1);
  });
});
