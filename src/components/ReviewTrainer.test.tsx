import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ReviewTrainingEngine,
  ReviewTrainingState,
} from '../review/engine';
import type { ReviewTrainingService } from '../services/reviewTrainingService';
import { ReviewTrainer } from './ReviewTrainer';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: any }) => (
    <div
      data-testid="review-board"
      data-orientation={options.boardOrientation}
      data-position={options.position}
    >
      <button onClick={() => options.onSquareClick?.({ square: 'e2', piece: { pieceType: 'wP' } })}>
        click e2
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'e4', piece: null })}>
        click e4
      </button>
      <button
        onClick={() =>
          options.onPieceDrop?.({
            sourceSquare: 'e2',
            targetSquare: 'e4',
            piece: { pieceType: 'wP' },
          })
        }
      >
        drag e2-e4
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'a7', piece: { pieceType: 'wP' } })}>
        click a7
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'a8', piece: null })}>
        click a8
      </button>
    </div>
  ),
}));

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function state(overrides: Partial<ReviewTrainingState> = {}): ReviewTrainingState {
  return {
    repertoireId: '00000000-0000-4000-8000-000000000010',
    repertoireName: 'Italian repertoire',
    learnerSide: 'w',
    fen: START_FEN,
    phase: 'awaiting-move',
    progress: { completed: 0, total: 2 },
    hintCount: 0,
    complete: false,
    relearning: false,
    moreAvailable: false,
    ...overrides,
  };
}

function engine(initial: ReviewTrainingState) {
  let current = initial;
  const api = {
    state: vi.fn(() => current),
    requestHint: vi.fn(() => {
      current = { ...current, hintCount: 1, hintText: 'Consider a Pawn move.' };
      return current;
    }),
    submitMove: vi.fn(async () => current),
    retryPersistence: vi.fn(async () => current),
    stop: vi.fn().mockResolvedValue(undefined),
    setState(next: ReviewTrainingState) {
      current = next;
    },
  };
  return api as unknown as ReviewTrainingEngine & {
    setState(next: ReviewTrainingState): void;
  };
}

function serviceWith(
  startSession: ReturnType<typeof vi.fn>,
): ReviewTrainingService {
  return { startSession } as unknown as ReviewTrainingService;
}

describe('ReviewTrainer', () => {
  it('uses the current review FEN/orientation and updates repertoire metadata across mixed cards', async () => {
    const first = state();
    const next = state({
      repertoireId: '00000000-0000-4000-8000-000000000020',
      repertoireName: 'Caro-Kann repertoire',
      learnerSide: 'b',
      fen: AFTER_E4,
      progress: { completed: 1, total: 2 },
    });
    const reviewEngine = engine(first);
    vi.mocked(reviewEngine.submitMove).mockImplementationOnce(async () => {
      reviewEngine.setState(next);
      return next;
    });
    const startSession = vi.fn().mockResolvedValue(reviewEngine);

    render(
      <ReviewTrainer
        service={serviceWith(startSession)}
        onExit={vi.fn()}
      />,
    );

    const board = await screen.findByTestId('review-board');
    expect(board).toHaveAttribute('data-position', START_FEN);
    expect(board).toHaveAttribute('data-orientation', 'white');
    expect(screen.getByRole('heading', { name: 'Italian repertoire' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'drag e2-e4' }));

    expect(reviewEngine.submitMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });
    await waitFor(() =>
      expect(screen.getByTestId('review-board')).toHaveAttribute('data-orientation', 'black'),
    );
    expect(screen.getByTestId('review-board')).toHaveAttribute('data-position', AFTER_E4);
    expect(screen.getByRole('heading', { name: 'Caro-Kann repertoire' })).toBeInTheDocument();
  });

  it('supports click-to-move and explicit promotion choice', async () => {
    const standard = engine(state());
    const standardStart = vi.fn().mockResolvedValue(standard);
    const first = render(
      <ReviewTrainer service={serviceWith(standardStart)} onExit={vi.fn()} />,
    );
    await screen.findByTestId('review-board');

    await userEvent.click(screen.getByRole('button', { name: 'click e2' }));
    await userEvent.click(screen.getByRole('button', { name: 'click e4' }));
    expect(standard.submitMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });

    first.unmount();

    const promotion = engine(state({
      fen: '7k/P7/8/8/8/8/8/K7 w - - 0 1',
    }));
    render(
      <ReviewTrainer
        service={serviceWith(vi.fn().mockResolvedValue(promotion))}
        onExit={vi.fn()}
      />,
    );
    await screen.findByTestId('review-board');

    await userEvent.click(screen.getByRole('button', { name: 'click a7' }));
    await userEvent.click(screen.getByRole('button', { name: 'click a8' }));
    expect(screen.getByRole('dialog', { name: /choose promotion piece/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Knight' }));
    expect(promotion.submitMove).toHaveBeenCalledWith({
      from: 'a7',
      to: 'a8',
      promotion: 'n',
    });
  });

  it('renders hint, save-retry feedback, completion summary, and Continue Reviewing', async () => {
    const reviewEngine = engine(state());
    const storageState = state({
      phase: 'resolved-not-persisted',
      feedback: {
        kind: 'storage-error',
        message: 'Could not save this review. Retry to continue.',
        rating: 'good',
        decisionTimeMs: 1800,
      },
    });
    const completeState = state({
      phase: 'complete',
      progress: { completed: 2, total: 2 },
      complete: true,
      moreAvailable: true,
      summary: {
        uniqueCardsReviewed: 2,
        firstResponsePreferred: 1,
        hardOutcomes: 0,
        againOutcomes: 1,
        relearningCompleted: 1,
        averageDecisionTimeMs: 2200,
        remainingAfterBatch: 4,
      },
    });

    vi.mocked(reviewEngine.submitMove).mockImplementationOnce(async () => {
      reviewEngine.setState(storageState);
      return storageState;
    });
    vi.mocked(reviewEngine.retryPersistence).mockImplementationOnce(async () => {
      reviewEngine.setState(completeState);
      return completeState;
    });

    const secondEngine = engine(state({ repertoireName: 'Next batch' }));
    const startSession = vi.fn()
      .mockResolvedValueOnce(reviewEngine)
      .mockResolvedValueOnce(secondEngine);

    render(
      <ReviewTrainer service={serviceWith(startSession)} onExit={vi.fn()} />,
    );
    await screen.findByTestId('review-board');

    await userEvent.click(screen.getByRole('button', { name: /^hint$/i }));
    expect(screen.getByText('Consider a Pawn move.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'drag e2-e4' }));
    expect(await screen.findByRole('button', { name: /retry save/i })).toBeInTheDocument();
    expect(screen.getByText(/could not save this review/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /retry save/i }));
    expect(await screen.findByRole('heading', { name: /session complete/i })).toBeInTheDocument();
    expect(screen.getByText(/2 cards reviewed/i)).toBeInTheDocument();
    expect(screen.getByText(/1 relearned/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.2s average/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /continue reviewing/i }));
    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(2));
  });
});
