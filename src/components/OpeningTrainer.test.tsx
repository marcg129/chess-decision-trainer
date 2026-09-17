import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpeningTrainingEngine } from '../openings/training/engine';
import type {
  OpeningTrainingState,
  OpeningTrainingMode,
} from '../openings/training/types';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import { OpeningTrainer } from './OpeningTrainer';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: any }) => (
    <div
      data-testid="opening-board"
      data-position={options.position}
      data-orientation={options.boardOrientation}
      data-draggable={String(options.allowDragging)}
    >
      <button onClick={() => options.onSquareClick?.({ square: 'e2', piece: { pieceType: 'wP' } })}>
        click e2
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'e4', piece: null })}>
        click e4
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'a7', piece: { pieceType: 'wP' } })}>
        click a7
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'a8', piece: null })}>
        click a8
      </button>
      <button
        onClick={() => options.onPieceDrop?.({ sourceSquare: 'e2', targetSquare: 'e4' })}
      >
        drag e2-e4
      </button>
    </div>
  ),
}));

const REPERTOIRE_ID = '00000000-0000-4000-8000-000000000030';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function baseState(overrides: Partial<OpeningTrainingState> = {}): OpeningTrainingState {
  return {
    mode: 'quick-recall',
    repertoireId: REPERTOIRE_ID,
    repertoireName: 'White repertoire',
    learnerSide: 'w',
    fen: START_FEN,
    phase: 'awaiting-move',
    progress: { completed: 0, total: 10 },
    hintCount: 0,
    complete: false,
    ...overrides,
  };
}

function makeEngine(initial = baseState()) {
  let current = initial;
  const engine = {
    state: vi.fn(() => current),
    requestHint: vi.fn(() => {
      current = {
        ...current,
        hintCount: current.hintCount + 1,
        hintText: 'Pawn move. Claim the center.',
      };
      return current;
    }),
    submitMove: vi.fn(async () => current),
    retryPersistence: vi.fn(async () => current),
    stop: vi.fn().mockResolvedValue(undefined),
    setState(next: OpeningTrainingState) {
      current = next;
    },
  };
  return engine;
}

function fakeService(engine: ReturnType<typeof makeEngine>): OpeningTrainingService {
  return {
    startSession: vi.fn().mockResolvedValue(engine as unknown as OpeningTrainingEngine),
  } as unknown as OpeningTrainingService;
}

function renderTrainer(
  engine = makeEngine(),
  mode: OpeningTrainingMode = 'quick-recall',
  onExit = vi.fn(),
) {
  const service = fakeService(engine);
  render(
    <OpeningTrainer
      service={service}
      repertoireId={REPERTOIRE_ID}
      mode={mode}
      onExit={onExit}
    />,
  );
  return { engine, service, onExit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OpeningTrainer', () => {
  it('starts a session, shows learner orientation and progress, and submits click/tap moves', async () => {
    const { engine, service } = renderTrainer();

    expect(await screen.findByText(/your move/i)).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 10/)).toBeInTheDocument();
    expect(screen.getByTestId('opening-board')).toHaveAttribute('data-orientation', 'white');
    expect(service.startSession).toHaveBeenCalledWith({
      repertoireId: REPERTOIRE_ID,
      mode: 'quick-recall',
    });

    await userEvent.click(screen.getByRole('button', { name: 'click e2' }));
    await userEvent.click(screen.getByRole('button', { name: 'click e4' }));
    await waitFor(() =>
      expect(engine.submitMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' }),
    );
  });

  it('submits drag moves through the same engine method', async () => {
    const { engine } = renderTrainer();
    await screen.findByText(/your move/i);

    await userEvent.click(screen.getByRole('button', { name: 'drag e2-e4' }));
    await waitFor(() =>
      expect(engine.submitMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' }),
    );
  });

  it('shows progressive hints only after Hint is requested', async () => {
    const { engine } = renderTrainer();
    await screen.findByText(/your move/i);
    expect(screen.queryByText(/claim the center/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^hint$/i }));

    expect(engine.requestHint).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/pawn move\. claim the center/i)).toBeInTheDocument();
  });

  it('renders first-miss and revealed correction feedback without changing the prompt board', async () => {
    const engine = makeEngine();
    engine.submitMove
      .mockImplementationOnce(async () => {
        const next = baseState({
          phase: 'retry',
          feedback: { kind: 'incorrect', message: 'Not quite. Look again.' },
        });
        engine.setState(next);
        return next;
      })
      .mockImplementationOnce(async () => {
        const next = baseState({
          phase: 'revealed',
          feedback: {
            kind: 'revealed',
            message: 'Try Nf3.',
            preferredSan: 'Nf3',
            explanation: 'Develop toward the center.',
          },
        });
        engine.setState(next);
        return next;
      });
    renderTrainer(engine);
    await screen.findByText(/your move/i);

    await userEvent.click(screen.getByRole('button', { name: 'drag e2-e4' }));
    expect(await screen.findByText(/not quite\. look again/i)).toBeInTheDocument();
    expect(screen.getByTestId('opening-board')).toHaveAttribute('data-position', START_FEN);

    await userEvent.click(screen.getByRole('button', { name: 'drag e2-e4' }));
    expect(await screen.findByText(/try nf3/i)).toBeInTheDocument();
    expect(screen.getByText(/develop toward the center/i)).toBeInTheDocument();
    expect(screen.getByTestId('opening-board')).toHaveAttribute('data-position', START_FEN);
  });

  it('shows accepted-alternative feedback with the preferred move and soft speed result', async () => {
    renderTrainer(
      makeEngine(
        baseState({
          feedback: {
            kind: 'alternative',
            message: 'Correct — accepted alternative.',
            preferredSan: 'Nf3',
            explanation: 'Both moves are in the repertoire.',
            decisionTimeMs: 3_800,
            speed: { targetMs: 5_000, status: 'good', label: 'Good speed' },
          },
        }),
      ),
    );

    expect(await screen.findByText(/accepted alternative/i)).toBeInTheDocument();
    expect(screen.getByText(/preferred: nf3/i)).toBeInTheDocument();
    expect(screen.getByText(/3\.8s/i)).toBeInTheDocument();
    expect(screen.getByText(/good speed/i)).toBeInTheDocument();
  });

  it('holds a graded position on storage failure and retries persistence explicitly', async () => {
    const failed = baseState({
      phase: 'resolved-not-persisted',
      feedback: {
        kind: 'preferred',
        message: 'Correct.',
        decisionTimeMs: 4_100,
        speed: { targetMs: 5_000, status: 'good', label: 'Good speed' },
      },
    });
    const engine = makeEngine(failed);
    engine.retryPersistence.mockImplementationOnce(async () => {
      const next = baseState({ progress: { completed: 1, total: 10 } });
      engine.setState(next);
      return next;
    });
    renderTrainer(engine);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
    expect(screen.getByTestId('opening-board')).toHaveAttribute('data-position', START_FEN);
    await userEvent.click(screen.getByRole('button', { name: /retry save/i }));
    expect(engine.retryPersistence).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/1 \/ 10/)).toBeInTheDocument();
  });

  it('renders completion and exits cleanly', async () => {
    const onExit = vi.fn();
    renderTrainer(
      makeEngine(
        baseState({
          phase: 'complete',
          complete: true,
          progress: { completed: 10, total: 10 },
        }),
      ),
      'quick-recall',
      onExit,
    );

    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /back to openings/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('requires a promotion choice before submitting a promotion move', async () => {
    const promotionFen = '7k/P7/8/8/8/8/8/K7 w - - 0 1';
    const engine = makeEngine(baseState({ fen: promotionFen }));
    renderTrainer(engine);
    await screen.findByText(/your move/i);

    await userEvent.click(screen.getByRole('button', { name: 'click a7' }));
    await userEvent.click(screen.getByRole('button', { name: 'click a8' }));
    expect(engine.submitMove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /choose promotion piece/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Knight' }));
    await waitFor(() =>
      expect(engine.submitMove).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: 'n' }),
    );
  });
});
