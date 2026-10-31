import { useEffect, useMemo, useState } from 'react';
import {
  Chessboard,
  type PieceDropHandlerArgs,
  type SquareHandlerArgs,
} from 'react-chessboard';
import type { Square } from 'chess.js';
import '../openingTraining.css';
import { ChessGame } from '../core/game';
import {
  getBrowserReviewTrainingService,
} from '../persistence/browserRepository';
import type {
  ReviewTrainingEngine,
  ReviewTrainingState,
} from '../review/engine';
import type { ReviewTrainingService } from '../services/reviewTrainingService';
import type { EntityId, TrainingMoveInput } from '../training/types';
import { PromotionPicker, type PromotionPiece } from './PromotionPicker';

type PendingPromotion = { from: Square; to: Square };

type ReviewTrainerProps = {
  service?: ReviewTrainingService;
  repertoireId?: EntityId;
  onExit: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Review Due session failed.';
}

function progressText(state: ReviewTrainingState): string {
  return `${state.progress.completed} / ${state.progress.total}`;
}

export function ReviewTrainer({
  service,
  repertoireId,
  onExit,
}: ReviewTrainerProps) {
  const client = useMemo(
    () => service ?? getBrowserReviewTrainingService(),
    [service],
  );
  const [restartKey, setRestartKey] = useState(0);
  const [engine, setEngine] = useState<ReviewTrainingEngine | null>(null);
  const [state, setState] = useState<ReviewTrainingState | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let startedEngine: ReviewTrainingEngine | null = null;
    let stopStarted = false;

    const stopStartedEngine = async (target: ReviewTrainingEngine) => {
      if (stopStarted) return;
      stopStarted = true;
      try {
        await target.stop();
      } catch {
        // Cleanup cannot safely surface an error after the trainer unmounts.
      }
    };

    setEngine(null);
    setState(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setError(null);

    void (async () => {
      try {
        const started = await client.startSession(
          repertoireId ? { repertoireId } : {},
        );
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
  }, [client, repertoireId, restartKey]);

  const game = useMemo(
    () => (state ? new ChessGame(state.fen) : null),
    [state?.fen],
  );

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

  const requestMove = (
    from: Square,
    to: Square,
  ): 'moved' | 'promotion' | 'invalid' => {
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
      if (
        replacement?.color === state.learnerSide
        && game.legalMoves(target).length > 0
      ) {
        setSelectedSquare(target);
      } else {
        setSelectedSquare(null);
      }
    }
  };

  const onPieceDrop = ({
    sourceSquare,
    targetSquare,
  }: PieceDropHandlerArgs): boolean => {
    if (!targetSquare) return false;
    return requestMove(
      sourceSquare as Square,
      targetSquare as Square,
    ) === 'moved';
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

  const continueReviewing = () => {
    setRestartKey((current) => current + 1);
  };

  if (!state) {
    return (
      <section className="opening-trainer review-trainer" aria-label="Review Due trainer">
        {error ? (
          <>
            <p className="opening-training__alert" role="alert">{error}</p>
            <button type="button" onClick={onExit}>Back to openings</button>
          </>
        ) : (
          <p className="empty-state">Loading Review Due session…</p>
        )}
      </section>
    );
  }

  const boardOptions = {
    id: 'review-training-board',
    position: state.fen,
    boardOrientation:
      state.learnerSide === 'w' ? ('white' as const) : ('black' as const),
    onPieceDrop,
    onSquareClick,
    allowDragging: moveInputEnabled,
    squareStyles: selectedSquare
      ? {
          [selectedSquare]: {
            boxShadow: 'inset 0 0 0 4px rgba(47, 111, 78, 0.65)',
          },
        }
      : {},
    animationDurationInMs: 140,
    lightSquareStyle: { backgroundColor: '#e6e1d5' },
    darkSquareStyle: { backgroundColor: '#71836c' },
    boardStyle: { borderRadius: '6px', overflow: 'hidden' },
  };

  return (
    <section
      className="opening-trainer review-trainer"
      aria-labelledby="review-trainer-heading"
    >
      <header className="opening-trainer__header">
        <div>
          <p className="panel-kicker">
            {state.relearning ? 'Review Due · Relearning' : 'Review Due'}
          </p>
          <h2 id="review-trainer-heading">{state.repertoireName}</h2>
        </div>
        <div
          className="opening-trainer__progress"
          aria-label="Review session progress"
        >
          {progressText(state)}
        </div>
      </header>

      {error && <p className="opening-training__alert" role="alert">{error}</p>}

      {state.complete ? (
        <div className="opening-trainer__complete">
          <h3>Session complete</h3>
          {state.summary ? (
            <div className="review-trainer__summary">
              <strong>{state.summary.uniqueCardsReviewed} cards reviewed</strong>
              <span>
                {state.summary.firstResponsePreferred} preferred first-try
              </span>
              <span>{state.summary.againOutcomes} Again</span>
              <span>{state.summary.relearningCompleted} relearned</span>
              {state.summary.averageDecisionTimeMs !== null && (
                <span>
                  {(state.summary.averageDecisionTimeMs / 1000).toFixed(1)}s average
                </span>
              )}
              {state.summary.remainingAfterBatch > 0 && (
                <span>{state.summary.remainingAfterBatch} still available</span>
              )}
            </div>
          ) : (
            <p>{progressText(state)}</p>
          )}
          <div className="opening-trainer__actions">
            {state.moreAvailable && (
              <button
                type="button"
                className="opening-home__primary"
                onClick={continueReviewing}
              >
                Continue Reviewing
              </button>
            )}
            <button type="button" onClick={onExit}>Back to openings</button>
          </div>
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
                <p>{state.feedback?.message ?? 'Could not save this review.'}</p>
                <button
                  type="button"
                  onClick={() => void handleRetryPersistence()}
                >
                  Retry save
                </button>
              </div>
            )}

            {state.feedback && state.phase !== 'resolved-not-persisted' && (
              <div
                className={`opening-trainer__feedback opening-trainer__feedback--${state.feedback.kind}`}
              >
                <strong>{state.feedback.message}</strong>
                {state.feedback.rating && (
                  <span>Grade: {state.feedback.rating}</span>
                )}
                {state.feedback.preferredSan && (
                  <span>Preferred: {state.feedback.preferredSan}</span>
                )}
                {state.feedback.explanation && <p>{state.feedback.explanation}</p>}
                {state.feedback.decisionTimeMs !== undefined && (
                  <span>{(state.feedback.decisionTimeMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            )}

            {state.hintText && (
              <p className="opening-trainer__hint">{state.hintText}</p>
            )}

            <div className="opening-trainer__actions">
              <button
                type="button"
                onClick={handleHint}
                disabled={
                  !moveInputEnabled
                  || state.phase === 'resolved-not-persisted'
                }
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
