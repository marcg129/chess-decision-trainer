import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReviewTrainingEngine, ReviewTrainingState } from '../review/engine';
import type { ReviewTrainingService } from '../services/reviewTrainingService';
import { ReviewTrainer } from './ReviewTrainer';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: any }) => (
    <div data-testid="review-board" data-position={options.position} />
  ),
}));

const STATE: ReviewTrainingState = {
  repertoireId: '00000000-0000-4000-8000-000000000010',
  repertoireName: 'Italian repertoire',
  learnerSide: 'w',
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  phase: 'awaiting-move',
  progress: { completed: 0, total: 1 },
  hintCount: 0,
  complete: false,
  relearning: false,
  moreAvailable: false,
};

function fakeEngine() {
  return {
    state: vi.fn(() => STATE),
    requestHint: vi.fn(() => STATE),
    submitMove: vi.fn(async () => STATE),
    retryPersistence: vi.fn(async () => STATE),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReviewTrainingEngine;
}

function fakeService(startSession: ReturnType<typeof vi.fn>): ReviewTrainingService {
  return { startSession } as unknown as ReviewTrainingService;
}

it('stops an active review engine exactly once when unmounted', async () => {
  const reviewEngine = fakeEngine();
  const { unmount } = render(
    <ReviewTrainer
      service={fakeService(vi.fn().mockResolvedValue(reviewEngine))}
      onExit={vi.fn()}
    />,
  );

  await screen.findByTestId('review-board');
  unmount();

  await waitFor(() => expect(reviewEngine.stop).toHaveBeenCalledTimes(1));
});

it('stops an engine exactly once if startSession resolves after unmount', async () => {
  const reviewEngine = fakeEngine();
  let resolveStart!: (engine: ReviewTrainingEngine) => void;
  const pending = new Promise<ReviewTrainingEngine>((resolve) => {
    resolveStart = resolve;
  });
  const { unmount } = render(
    <ReviewTrainer
      service={fakeService(vi.fn().mockReturnValue(pending))}
      onExit={vi.fn()}
    />,
  );

  unmount();
  resolveStart(reviewEngine);

  await waitFor(() => expect(reviewEngine.stop).toHaveBeenCalledTimes(1));
});
