import { useEffect, useMemo, useState } from 'react';
import {
  Chessboard,
  type PieceDropHandlerArgs,
  type SquareHandlerArgs,
} from 'react-chessboard';
import type { Square } from 'chess.js';
import '../openingTraining.css';
import { ChessGame } from '../core/game';
import type { OpeningTrainingEngine } from '../openings/training/engine';
import type {
  OpeningTrainingMode,
  OpeningTrainingState,
} from '../openings/training/types';
import { getBrowserOpeningTrainingService } from '../persistence/browserRepository';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { EntityId, TrainingMoveInput } from '../training/types';
import { PromotionPicker, type PromotionPiece } from './PromotionPicker';

type PendingPromotion = { from: Square; to: Square };

type OpeningTrainerProps = {
  service?: OpeningTrainingService;
  repertoireId: EntityId;
  mode: OpeningTrainingMode;
  onExit: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Opening training session failed.';
}

function progressText(state: OpeningTrainingState): string {
  return state.progress.total === null
    ? `${state.progress.completed} moves completed`
    : `${state.progress.completed} / ${state.progress.total}`;
}

export function OpeningTrainer({
  service,
  repertoireId,
  mode,
  onExit,
}: OpeningTrainerProps) {
  const client = useMemo(() => service ?? getBrowserOpeningTrainingService(), [service]);
  const [engine, setEngine] = useState<OpeningTrainingEngine | null>(null);
  const [state, setState] = useState<OpeningTrainingState | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let startedEngine: OpeningTrainingEngine | null = null;
    let stopStarted = false;

    const stopStartedEngine = async (target: OpeningTrainingEngine) => {
      if (stopStarted) return;
      stopStarted = true;
      try {
        await target.stop();
      } catch {
        // Cleanup cannot safely surface an error after the trainer has unmounted.
      }
    };

    setEngine(null);
    setState(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setError(null);

    void (async () => {
      try {
        const started = await client.startSession({ repertoireId, mode });
        startedEngine = started;
        if (!active) {
          await stopStartedEngine(started);
          return;
        }
        setEngine(started);
        setState(started.state());
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      }
    })();

    return () => {
      active = false;
      if (startedEngine) void stopStartedEngine(startedEngine);
    };
  }, [client, repertoireId, mode]);

  const game = useMemo(() => (state ? new ChessGame(state.fen) : null), [state?.fen]);
  const canSubmitPrompt = Boolean(
    engine
      && state
      && !state.complete
      && ['awaiting-move', 'retry', 'revealed'].includes(state.phase),
  );
  const moveInputEnabled = canSubmitPrompt && pendingPromotion === null;

  const submit = async (move: TrainingMoveInput) => {
    if (!engine || !canSubmitPrompt) return;
    setError(null);
    try {
      const next = await engine.submitMove(move);
      setState(next);
      setSelectedSquare(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const requestMove = (from: Square, to: Square): 'moved' | 'promotion' | 'invalid' => {
    if (!moveInputEnabled || !game) return 'invalid';
    const legalMoves = game.legalMoves(from).filter((candidate) => candidate.to === to);
    if (legalMoves.length === 0) return 'invalid';
    if (legalMoves.some((candidate) => candidate.promotion !== undefined)) {
      setPendingPromotion({ from, to });
      setSelectedSquare(null);
      return 'promotion';
    }
    void submit({ from, to });
    return 'moved';
  };

  const onSquareClick = ({ square }: SquareHandlerArgs) => {
    if (!moveInputEnabled || !game || !state) return;
    const target = square as Square;

    if (selectedSquare === null) {
      const piece = game.pieceAt(target);
      if (piece?.color === state.learnerSide && game.legalMoves(target).length > 0) {
        setSelectedSquare(target);
      }
      return;
    }

    if (target === selectedSquare) {
      setSelectedSquare(null);
      return;
    }

    const result = requestMove(selectedSquare, target);
    if (result === 'invalid') {
      const replacement = game.pieceAt(target);
      if (replacement?.color === state.learnerSide && game.legalMoves(target).length > 0) {
        setSelectedSquare(target);
      } else {
        setSelectedSquare(null);
      }
    }
  };

  const onPieceDrop = ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!targetSquare) return false;
    return requestMove(sourceSquare as Square, targetSquare as Square) === 'moved';
  };

  const handlePromotion = (piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    const move = {
      from: pendingPromotion.from,
      to: pendingPromotion.to,
      promotion: piece,
    } satisfies TrainingMoveInput;
    setPendingPromotion(null);
    void submit(move);
  };

  const handleHint = () => {
    if (!engine) return;
    setState(engine.requestHint());
  };

  const handleRetryPersistence = async () => {
    if (!engine) return;
    setError(null);
    try {
      setState(await engine.retryPersistence());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const handleExit = async () => {
    if (engine && !state?.complete) {
      try {
        await engine.stop();
      } catch (caught) {
        setError(errorMessage(caught));
        return;
      }
    }
    onExit();
  };

  if (!state) {
    return (
      <section className="opening-trainer" aria-label="Opening trainer">
        {error ? (
          <>
            <p className="opening-training__alert" role="alert">{error}</p>
            <button type="button" onClick={onExit}>Back to openings</button>
          </>
        ) : (
          <p className="empty-state">Loading opening session…</p>
        )}
      </section>
    );
  }

  const boardOptions = {
    id: 'opening-training-board',
    position: state.fen,
    boardOrientation: state.learnerSide === 'w' ? ('white' as const) : ('black' as const),
    onPieceDrop,
    onSquareClick,
    allowDragging: moveInputEnabled,
    squareStyles: selectedSquare
      ? { [selectedSquare]: { boxShadow: 'inset 0 0 0 4px rgba(47, 111, 78, 0.65)' } }
      : {},
    animationDurationInMs: 140,
    lightSquareStyle: { backgroundColor: '#e6e1d5' },
    darkSquareStyle: { backgroundColor: '#71836c' },
    boardStyle: { borderRadius: '6px', overflow: 'hidden' },
  };

  return (
    <section className="opening-trainer" aria-labelledby="opening-trainer-heading">
      <header className="opening-trainer__header">
        <div>
          <p className="panel-kicker">
            {state.mode === 'practice-line' ? 'Practice Line' : 'Quick Recall'}
          </p>
          <h2 id="opening-trainer-heading">{state.repertoireName}</h2>
        </div>
        <div className="opening-trainer__progress" aria-label="Session progress">
          {progressText(state)}
        </div>
      </header>

      {error && <p className="opening-training__alert" role="alert">{error}</p>}

      {state.complete ? (
        <div className="opening-trainer__complete">
          <h3>Session complete</h3>
          <p>{progressText(state)}</p>
          <button type="button" onClick={() => void handleExit()}>Back to openings</button>
        </div>
      ) : (
        <div className="opening-trainer__layout">
          <div className="opening-trainer__board-wrap">
            <Chessboard options={boardOptions} />
          </div>

          <aside className="opening-trainer__side">
            <div className="opening-trainer__prompt">
              <strong>Your move</strong>
              <span>Target: under 5 seconds</span>
            </div>

            {state.phase === 'resolved-not-persisted' && (
              <div className="opening-training__alert" role="alert">
                <p>Your move was graded, but it could not be saved.</p>
                <button type="button" onClick={() => void handleRetryPersistence()}>
                  Retry save
                </button>
              </div>
            )}

            {state.feedback && (
              <div className={`opening-trainer__feedback opening-trainer__feedback--${state.feedback.kind}`}>
                <strong>{state.feedback.message}</strong>
                {state.feedback.kind === 'alternative' && state.feedback.preferredSan && (
                  <span>Preferred: {state.feedback.preferredSan}</span>
                )}
                {state.feedback.explanation && <p>{state.feedback.explanation}</p>}
                {state.feedback.decisionTimeMs !== undefined && (
                  <span>{(state.feedback.decisionTimeMs / 1000).toFixed(1)}s</span>
                )}
                {state.feedback.speed && <span>{state.feedback.speed.label}</span>}
              </div>
            )}

            {state.hintText && <p className="opening-trainer__hint">{state.hintText}</p>}

            <div className="opening-trainer__actions">
              <button
                type="button"
                onClick={handleHint}
                disabled={!moveInputEnabled || state.phase === 'resolved-not-persisted'}
              >
                Hint
              </button>
              <button type="button" onClick={() => void handleExit()}>
                Exit session
              </button>
            </div>
          </aside>
        </div>
      )}

      {pendingPromotion && (
        <PromotionPicker
          onChoose={handlePromotion}
          onCancel={() => setPendingPromotion(null)}
        />
      )}
    </section>
  );
}
