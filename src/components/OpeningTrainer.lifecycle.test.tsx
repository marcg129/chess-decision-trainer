import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OpeningTrainingEngine } from '../openings/training/engine';
import type { OpeningTrainingState } from '../openings/training/types';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import { OpeningTrainer } from './OpeningTrainer';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeEngine() {
  const state: OpeningTrainingState = {
    mode: 'practice-line',
    repertoireId: 'rep-1',
    repertoireName: 'Lifecycle fixture',
    learnerSide: 'w',
    fen: START_FEN,
    phase: 'awaiting-move',
    progress: { completed: 0, total: null },
    hintCount: 0,
    complete: false,
  };
  const stop = vi.fn().mockResolvedValue(undefined);
  const engine = {
    state: () => state,
    stop,
    requestHint: () => state,
    submitMove: vi.fn().mockResolvedValue(state),
    retryPersistence: vi.fn().mockResolvedValue(state),
  } as unknown as OpeningTrainingEngine;
  return { engine, stop };
}

describe('OpeningTrainer lifecycle', () => {
  it('stops an active training session when the trainer unmounts', async () => {
    const { engine, stop } = makeEngine();
    const service = {
      startSession: vi.fn().mockResolvedValue(engine),
    } as unknown as OpeningTrainingService;

    const { unmount } = render(
      <OpeningTrainer
        service={service}
        repertoireId="rep-1"
        mode="practice-line"
        onExit={() => undefined}
      />,
    );

    await screen.findByRole('heading', { name: 'Lifecycle fixture' });
    unmount();

    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it('stops a session that finishes starting after the trainer already unmounted', async () => {
    const { engine, stop } = makeEngine();
    let releaseStart!: (value: OpeningTrainingEngine) => void;
    const startPromise = new Promise<OpeningTrainingEngine>((resolve) => {
      releaseStart = resolve;
    });
    const service = {
      startSession: vi.fn().mockReturnValue(startPromise),
    } as unknown as OpeningTrainingService;

    const { unmount } = render(
      <OpeningTrainer
        service={service}
        repertoireId="rep-1"
        mode="practice-line"
        onExit={() => undefined}
      />,
    );

    await waitFor(() => expect(service.startSession).toHaveBeenCalledTimes(1));
    unmount();
    releaseStart(engine);

    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });
});
