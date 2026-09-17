import { useMemo, useRef, useState } from 'react';
import {
  Chessboard,
  type PieceDropHandlerArgs,
  type SquareHandlerArgs,
} from 'react-chessboard';
import type { Square } from 'chess.js';
import { ChessClock } from './components/ChessClock';
import { MoveList } from './components/MoveList';
import { PositionDataPanel } from './components/PositionDataPanel';
import {
  PromotionPicker,
  type PromotionPiece,
} from './components/PromotionPicker';
import { TrainingDataPanel } from './components/TrainingDataPanel';
import { ChessGame, type GameSnapshot } from './core/game';
import { createMoveDecisionRecord } from './core/moveTelemetry';
import type { MoveDecisionRecord } from './core/trainingTypes';
import { useChessClock } from './hooks/useChessClock';
import type { TrainingDataService } from './services/trainingDataService';

const CLOCK_CONFIG = { initialMs: 180_000, incrementMs: 2_000 };

type Orientation = 'white' | 'black';
type MoveRequestResult = 'moved' | 'promotion' | 'invalid';
type PendingPromotion = { from: Square; to: Square };

type AppProps = {
  initialFen?: string;
  trainingDataService?: TrainingDataService;
};

function statusText(snapshot: GameSnapshot, flagged: 'w' | 'b' | null, running: boolean): string {
  if (flagged) return `${flagged === 'w' ? 'White' : 'Black'} lost on time`;
  switch (snapshot.status) {
    case 'checkmate':
      return 'Checkmate';
    case 'stalemate':
      return 'Stalemate';
    case 'insufficient-material':
      return 'Draw · insufficient material';
    case 'threefold-repetition':
      return 'Draw · threefold repetition';
    case 'draw':
      return 'Draw';
    default:
      return `${snapshot.turn === 'w' ? 'White' : 'Black'} to move${running ? '' : ' · clock paused'}`;
  }
}

export default function App({ initialFen, trainingDataService }: AppProps) {
  const gameRef = useRef<ChessGame | null>(null);
  if (gameRef.current === null) {
    gameRef.current = new ChessGame(initialFen);
  }
  const game = gameRef.current;

  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => game.snapshot());
  const [records, setRecords] = useState<MoveDecisionRecord[]>([]);
  const [orientation, setOrientation] = useState<Orientation>('white');
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const clock = useChessClock(CLOCK_CONFIG);

  const gameOver = snapshot.status !== 'playing' || clock.flagged !== null;
  const canMove = clock.running && !gameOver && pendingPromotion === null;

  const applyMove = (from: Square, to: Square, promotion?: PromotionPiece): boolean => {
    if (!clock.running || gameOver) return false;

    const before = game.snapshot();
    const move = game.move(from, to, promotion);
    if (!move) return false;
    const after = game.snapshot();
    const timing = clock.commitMove(move.color, after.turn);

    if (
      timing.decisionTimeMs === null ||
      timing.clockAfterMs === null ||
      timing.clockAfterMs === 0
    ) {
      game.undo();
      setSnapshot(game.snapshot());
      return false;
    }

    setRecords((current) => [
      ...current,
      createMoveDecisionRecord({
        ply: current.length + 1,
        move,
        before,
        after,
        timing,
      }),
    ]);
    setSnapshot(after);
    setSelectedSquare(null);

    if (after.status !== 'playing') {
      clock.pause();
    }
    return true;
  };

  const requestMove = (from: Square, to: Square): MoveRequestResult => {
    if (!canMove) return 'invalid';
    const promotionMove = game
      .legalMoves(from)
      .some((candidate) => candidate.to === to && candidate.promotion !== undefined);
    if (promotionMove) {
      setPendingPromotion({ from, to });
      setSelectedSquare(null);
      return 'promotion';
    }
    return applyMove(from, to) ? 'moved' : 'invalid';
  };

  const onSquareClick = ({ square }: SquareHandlerArgs) => {
    if (!canMove) return;
    const target = square as Square;

    if (selectedSquare === null) {
      const piece = game.pieceAt(target);
      if (piece?.color === snapshot.turn && game.legalMoves(target).length > 0) {
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
      if (replacement?.color === snapshot.turn && game.legalMoves(target).length > 0) {
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

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (!selectedSquare) return styles;
    styles[selectedSquare] = { boxShadow: 'inset 0 0 0 4px rgba(47, 111, 78, 0.65)' };
    for (const move of game.legalMoves(selectedSquare)) {
      const occupied = game.pieceAt(move.to) !== undefined;
      styles[move.to] = occupied
        ? { boxShadow: 'inset 0 0 0 5px rgba(25, 25, 25, 0.28)' }
        : { background: 'radial-gradient(circle, rgba(25,25,25,.3) 18%, transparent 20%)' };
    }
    return styles;
  }, [game, selectedSquare, snapshot.fen]);

  const handlePromotion = (piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    applyMove(pendingPromotion.from, pendingPromotion.to, piece);
    setPendingPromotion(null);
  };

  const handleUndo = () => {
    const undone = game.undo();
    if (!undone) return;
    clock.pause();
    setRecords((current) => current.slice(0, -1));
    setSelectedSquare(null);
    setPendingPromotion(null);
    setSnapshot(game.snapshot());
  };

  const handleNewGame = () => {
    clock.pause();
    if (initialFen) game.loadFen(initialFen);
    else game.reset();
    const next = game.snapshot();
    setSnapshot(next);
    setRecords([]);
    setSelectedSquare(null);
    setPendingPromotion(null);
    clock.reset(next.turn);
  };

  const boardOptions = {
    id: 'decision-trainer-board',
    position: snapshot.fen,
    boardOrientation: orientation,
    onPieceDrop,
    onSquareClick,
    squareStyles,
    allowDragging: canMove,
    animationDurationInMs: 160,
    lightSquareStyle: { backgroundColor: '#e6e1d5' },
    darkSquareStyle: { backgroundColor: '#71836c' },
    boardStyle: { borderRadius: '6px', overflow: 'hidden' },
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Phase 2 · Local training data</p>
          <h1>Chess Decision Trainer</h1>
        </div>
        <p className="status-line" role="status">
          {statusText(snapshot, clock.flagged, clock.running)}
        </p>
      </header>

      <section className="game-layout" aria-label="Chess game">
        <div className="board-column">
          <ChessClock
            color="b"
            ms={clock.blackMs}
            active={clock.active === 'b'}
            running={clock.running}
            flagged={clock.flagged === 'b'}
          />
          <div className="board-wrap">
            <Chessboard options={boardOptions} />
          </div>
          <ChessClock
            color="w"
            ms={clock.whiteMs}
            active={clock.active === 'w'}
            running={clock.running}
            flagged={clock.flagged === 'w'}
          />
        </div>

        <aside className="game-panel">
          <div className="game-actions">
            {!gameOver && !clock.running && (
              <button type="button" onClick={() => clock.start(snapshot.turn)}>
                {records.length === 0 ? 'Start game' : 'Resume'}
              </button>
            )}
            <button type="button" onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}>
              Flip board
            </button>
            <button type="button" onClick={handleUndo} disabled={snapshot.history.length === 0}>
              Undo
            </button>
            <button type="button" onClick={handleNewGame}>
              New game
            </button>
          </div>
          <section className="panel-section" aria-labelledby="move-history-heading">
            <div className="panel-heading-row">
              <div>
                <p className="panel-kicker">Decision telemetry</p>
                <h2 id="move-history-heading">Moves</h2>
              </div>
              <span className="data-badge">{records.length}</span>
            </div>
            <MoveList records={records} />
          </section>
          <PositionDataPanel
            fen={snapshot.fen}
            positionKey={snapshot.positionKey}
            pgn={snapshot.pgn}
            hasMoves={snapshot.history.length > 0}
          />
        </aside>
      </section>

      <div className="training-data-section">
        <TrainingDataPanel service={trainingDataService} />
      </div>

      {pendingPromotion && (
        <PromotionPicker
          onChoose={handlePromotion}
          onCancel={() => {
            setPendingPromotion(null);
            setSelectedSquare(null);
          }}
        />
      )}
    </main>
  );
}
