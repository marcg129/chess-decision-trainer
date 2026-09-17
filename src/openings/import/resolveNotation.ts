import type { Move, Square } from 'chess.js';
import { ChessGame } from '../../core/game';
import type { TrainingMoveInput } from '../../training/types';
import type { ParsedPgnMove } from '../pgn/types';

function matchesFromHint(from: Square, hint: string | undefined): boolean {
  if (!hint) return true;
  if (hint.length === 2) return from === hint;
  if (/^[a-h]$/.test(hint)) return from.startsWith(hint);
  if (/^[1-8]$/.test(hint)) return from.endsWith(hint);
  return false;
}

function matchesCastle(move: Move, castle: ParsedPgnMove['castle']): boolean {
  if (!castle) return true;
  if (move.piece !== 'k') return false;
  const distance = move.to.charCodeAt(0) - move.from.charCodeAt(0);
  return castle === 'kingside' ? distance === 2 : distance === -2;
}

export function resolveParsedMove(game: ChessGame, parsed: ParsedPgnMove): TrainingMoveInput {
  const snapshot = game.snapshot();
  if (snapshot.turn !== parsed.turn) {
    throw new Error(`PGN move ${parsed.moveNumber} has the wrong side to move.`);
  }

  const candidates = game.allLegalMoves().filter((move) => {
    if (move.piece !== parsed.piece) return false;
    if (!matchesCastle(move, parsed.castle)) return false;
    if (parsed.castle) return true;
    if (!parsed.to || move.to !== parsed.to) return false;
    if (!matchesFromHint(move.from, parsed.fromHint)) return false;
    if (Boolean(move.captured) !== parsed.capture) return false;
    if ((move.promotion ?? undefined) !== parsed.promotion) return false;
    return true;
  });

  if (candidates.length !== 1) {
    throw new Error(
      `Unable to resolve PGN move ${parsed.moveNumber}${parsed.turn} to exactly one legal move; found ${candidates.length}.`,
    );
  }

  const selected = candidates[0];
  const promotion = selected.promotion;
  if (promotion && promotion !== 'q' && promotion !== 'r' && promotion !== 'b' && promotion !== 'n') {
    throw new Error('Resolved PGN promotion piece is unsupported.');
  }
  return {
    from: selected.from,
    to: selected.to,
    ...(promotion ? { promotion } : {}),
  };
}
