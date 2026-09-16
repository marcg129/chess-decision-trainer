import { Chess, type Color, type Move, type Square } from 'chess.js';
import { positionKeyFromFen } from './positionIdentity';

export type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'insufficient-material'
  | 'threefold-repetition';

export type GameSnapshot = {
  fen: string;
  pgn: string;
  positionKey: string;
  turn: Color;
  history: Move[];
  status: GameStatus;
  inCheck: boolean;
};

export class ChessGame {
  private readonly chess: Chess;

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  snapshot(): GameSnapshot {
    const fen = this.chess.fen();
    return {
      fen,
      pgn: this.chess.pgn(),
      positionKey: positionKeyFromFen(fen),
      turn: this.chess.turn(),
      history: this.chess.history({ verbose: true }),
      status: this.status(),
      inCheck: this.chess.inCheck(),
    };
  }

  move(
    from: Square,
    to: Square,
    promotion?: 'q' | 'r' | 'b' | 'n',
  ): Move | null {
    try {
      return this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
  }

  undo(): Move | null {
    return this.chess.undo();
  }

  reset(): void {
    this.chess.reset();
  }

  loadFen(fen: string): void {
    this.chess.load(fen);
  }

  loadPgn(pgn: string): void {
    this.chess.loadPgn(pgn);
  }

  legalMoves(square: Square): Move[] {
    return this.chess.moves({ square, verbose: true });
  }

  pieceAt(square: Square): ReturnType<Chess['get']> {
    return this.chess.get(square);
  }

  requiresPromotion(from: Square, to: Square): boolean {
    const piece = this.chess.get(from);
    if (!piece || piece.type !== 'p') return false;
    return (
      (piece.color === 'w' && to.endsWith('8')) ||
      (piece.color === 'b' && to.endsWith('1'))
    );
  }

  private status(): GameStatus {
    if (this.chess.isCheckmate()) return 'checkmate';
    if (this.chess.isStalemate()) return 'stalemate';
    if (this.chess.isInsufficientMaterial()) return 'insufficient-material';
    if (this.chess.isThreefoldRepetition()) return 'threefold-repetition';
    if (this.chess.isDraw()) return 'draw';
    return 'playing';
  }
}
